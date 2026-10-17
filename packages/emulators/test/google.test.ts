import * as oidc from "openid-client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { google, googleOutboundFaults, seedGoogle } from "../src/google/index.ts"
import { ManualClock } from "../src/time.ts"

const CLIENT_ID = "123-app.apps.googleusercontent.com"
const CLIENT_SECRET = "GOCSPX-app-secret"
const REDIRECT_URI = "https://app.danwo.test/auth/google/callback"

let emulator: Emulator
let clock: ManualClock

/** openid-client's fetch, sent to the emulator: the URLs stay Google's real ones. */
const toEmulator = (url: string, { body, headers, method }: oidc.CustomFetchOptions) =>
  emulator.fetch(
    new Request(url, {
      body: body instanceof Uint8Array ? new Uint8Array(body) : (body ?? null),
      headers,
      method,
    }),
  )

async function discover(secret = CLIENT_SECRET): Promise<oidc.Configuration> {
  return oidc.discovery(new URL("https://accounts.google.com"), CLIENT_ID, secret, undefined, {
    [oidc.customFetch]: toEmulator,
  })
}

/** Plays the browser: opens the authorization URL, picks `email`'s account, returns the redirect. */
async function signIn(url: URL, email: string): Promise<URL> {
  const page = await emulator.fetch(new Request(url))
  const html = await page.text()

  expect(page.status).toBe(200)
  const request = /name="request" value="([^"]+)"/.exec(html)?.[1] ?? ""
  const item = html.split("<li>").find((li) => li.includes(email)) ?? ""
  const account = /name="user" value="([^"]+)"/.exec(item)?.[1] ?? ""
  const back = await emulator.fetch(
    new Request("https://accounts.google.com/o/oauth2/v2/auth/callback", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request, user: account }),
    }),
  )

  expect(back.status).toBe(302)

  return new URL(back.headers.get("location") ?? "")
}

async function authorizationUrl(config: oidc.Configuration, extra: Record<string, string> = {}) {
  const verifier = oidc.randomPKCECodeVerifier()
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: REDIRECT_URI,
    scope: "openid email profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state: "st-1",
    nonce: "n-1",
    access_type: "offline",
    ...extra,
  })

  return { url, verifier }
}

beforeEach(() => {
  clock = new ManualClock(new Date())
  emulator = createEmulator(google, { clock: clock.clock })
  seedGoogle(emulator.store, {
    users: [
      { email: "ada@danwo.test", name: "Ada Lovelace" },
      { email: "grace@corp.test", name: "Grace Hopper", hd: "corp.test" },
    ],
    oauth_clients: [
      {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        name: "Acme",
        redirect_uris: [REDIRECT_URI],
      },
    ],
  })
})

afterEach(async () => {
  await emulator.close()
})

describe("sign-in with openid-client", () => {
  it("runs the code flow with PKCE and verifies the ID token against the JWKS", async () => {
    const config = await discover()

    expect(config.serverMetadata()).toMatchObject({
      issuer: "https://accounts.google.com",
      token_endpoint: "https://oauth2.googleapis.com/token",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
    })
    const { url, verifier } = await authorizationUrl(config)
    const callback = await signIn(url, "ada@danwo.test")

    expect(callback.origin + callback.pathname).toBe(REDIRECT_URI)
    expect(callback.searchParams.get("state")).toBe("st-1")

    const tokens = await oidc.authorizationCodeGrant(config, callback, {
      pkceCodeVerifier: verifier,
      expectedState: "st-1",
      expectedNonce: "n-1",
      idTokenExpected: true,
    })
    const claims = tokens.claims()

    expect(tokens.access_token).toMatch(/^ya29\./)
    expect(tokens.refresh_token).toMatch(/^1\/\//)
    expect(tokens.scope).toBe(
      "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
    )
    expect(claims).toMatchObject({
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      azp: CLIENT_ID,
      email: "ada@danwo.test",
      email_verified: true,
      name: "Ada Lovelace",
      nonce: "n-1",
    })

    const info = await oidc.fetchUserInfo(config, tokens.access_token, claims?.sub ?? "")

    expect(info).toMatchObject({ sub: claims?.sub, email: "ada@danwo.test", given_name: "Ada" })
  })

  it("refreshes, and stops refreshing once the refresh token is revoked", async () => {
    const config = await discover()
    const { url, verifier } = await authorizationUrl(config)
    const tokens = await oidc.authorizationCodeGrant(config, await signIn(url, "grace@corp.test"), {
      pkceCodeVerifier: verifier,
      expectedState: "st-1",
      expectedNonce: "n-1",
    })
    const refreshed = await oidc.refreshTokenGrant(config, tokens.refresh_token ?? "")

    expect(refreshed.access_token).not.toBe(tokens.access_token)
    expect(refreshed.claims()).toMatchObject({ email: "grace@corp.test", hd: "corp.test" })

    await oidc.tokenRevocation(config, tokens.refresh_token ?? "")
    await expect(oidc.refreshTokenGrant(config, tokens.refresh_token ?? "")).rejects.toMatchObject({
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.",
    })
    await expect(
      oidc.fetchUserInfo(config, refreshed.access_token, oidc.skipSubjectCheck),
    ).rejects.toMatchObject({ status: 401 })
  })

  it("issues a refresh token only for access_type=offline", async () => {
    const config = await discover()
    const { url, verifier } = await authorizationUrl(config, { access_type: "online" })
    const tokens = await oidc.authorizationCodeGrant(config, await signIn(url, "ada@danwo.test"), {
      pkceCodeVerifier: verifier,
      expectedState: "st-1",
      expectedNonce: "n-1",
    })

    expect(tokens.refresh_token).toBeUndefined()
  })

  it("refuses a wrong PKCE verifier, a reused code and an expired token", async () => {
    const config = await discover()
    const { url, verifier } = await authorizationUrl(config)
    const callback = await signIn(url, "ada@danwo.test")
    const checks = { expectedState: "st-1", expectedNonce: "n-1" }

    await expect(
      oidc.authorizationCodeGrant(config, callback, {
        ...checks,
        pkceCodeVerifier: "wrong".repeat(10),
      }),
    ).rejects.toMatchObject({ error: "invalid_grant", error_description: "Invalid code verifier." })

    const tokens = await oidc.authorizationCodeGrant(config, callback, {
      ...checks,
      pkceCodeVerifier: verifier,
    })

    await expect(
      oidc.authorizationCodeGrant(config, callback, { ...checks, pkceCodeVerifier: verifier }),
    ).rejects.toMatchObject({ error: "invalid_grant" })

    clock.advance(3600 * 1000)
    await expect(
      oidc.fetchUserInfo(config, tokens.access_token, oidc.skipSubjectCheck),
    ).rejects.toMatchObject({ status: 401 })
  })

  it("refuses a wrong client secret with invalid_client", async () => {
    const config = await discover("GOCSPX-wrong")
    const { url, verifier } = await authorizationUrl(config)
    const callback = await signIn(url, "ada@danwo.test")

    await expect(
      oidc.authorizationCodeGrant(config, callback, {
        pkceCodeVerifier: verifier,
        expectedState: "st-1",
        expectedNonce: "n-1",
      }),
    ).rejects.toMatchObject({ error: "invalid_client", status: 401 })
  })
})

describe("the authorization page", () => {
  it("blocks an unregistered redirect URI and an unknown client before sign-in", async () => {
    const config = await discover()
    const { url } = await authorizationUrl(config, { redirect_uri: "https://evil.test/cb" })
    const mismatch = await emulator.fetch(new Request(url))

    expect(mismatch.status).toBe(400)
    expect(await mismatch.text()).toContain("Error 400: redirect_uri_mismatch")

    url.searchParams.set("client_id", "unknown.apps.googleusercontent.com")
    const unknown = await emulator.fetch(new Request(url))

    expect(await unknown.text()).toContain("Error 401: invalid_client")
  })

  it("lists seeded accounts by accessible name and sends access_denied on Cancel", async () => {
    const config = await discover()
    const { url } = await authorizationUrl(config)
    const html = await (await emulator.fetch(new Request(url))).text()

    expect(html).toContain('aria-label="Continue as Ada Lovelace"')
    const request = /name="request" value="([^"]+)"/.exec(html)?.[1] ?? ""
    const back = await emulator.fetch(
      new Request("https://accounts.google.com/o/oauth2/v2/auth/callback", {
        method: "POST",
        body: new URLSearchParams({ request, deny: "1" }),
      }),
    )
    const location = new URL(back.headers.get("location") ?? "")

    expect(location.searchParams.get("error")).toBe("access_denied")
    expect(location.searchParams.get("state")).toBe("st-1")
  })
})

describe("googleOutboundFaults", () => {
  it("faults the server-to-server calls and leaves the browser's alone", () => {
    expect(googleOutboundFaults({ method: "POST", path: "/token" }).map((f) => f.kind)).toEqual([
      "status",
      "status",
      "status",
      "delay",
      "reset",
      "reset-after",
    ])
    expect(googleOutboundFaults({ method: "GET", path: "/v1/userinfo" })).toHaveLength(2)
    expect(googleOutboundFaults({ method: "GET", path: "/oauth2/v3/certs" })).toHaveLength(2)
    expect(googleOutboundFaults({ method: "GET", path: "/o/oauth2/v2/auth" })).toEqual([])
  })
})
