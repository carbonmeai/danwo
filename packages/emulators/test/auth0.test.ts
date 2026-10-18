import { ManagementClient } from "auth0"
import * as oidc from "openid-client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  auth0,
  auth0OtpAt,
  auth0OutboundFaults,
  auth0Tenant,
  type Auth0SeedConfig,
  connectAuth0Upstream,
  seedAuth0,
} from "../src/auth0/index.ts"
import { createEmulator, type Emulator } from "../src/define.ts"
import { google, seedGoogle } from "../src/google/index.ts"
import { ManualClock } from "../src/time.ts"
import { LoginBrowser, locationOf } from "./auth0-browser.ts"

const DOMAIN = "acme.us.auth0.com"
const ISSUER = `https://${DOMAIN}/`
const API = "https://api.acme.test"
const WEB = {
  id: "web-client-id",
  secret: "web-client-secret",
  callback: "https://app.acme.test/callback",
}
const MFA_SECRET = "JBSWY3DPEHPK3PXP"

export const ACME: Auth0SeedConfig = {
  tenants: [
    {
      domain: DOMAIN,
      custom_domains: ["login.acme.test"],
      friendly_name: "Acme",
      post_login_claims: { "https://acme.test/plan": "pro" },
      roles_claim: "https://acme.test/roles",
      clients: [
        {
          client_id: WEB.id,
          client_secret: WEB.secret,
          name: "Acme Web",
          callbacks: [WEB.callback],
          allowed_logout_urls: ["https://app.acme.test/"],
          refresh_token: { rotation: "rotating" },
        },
        {
          client_id: "m2m-client-id",
          client_secret: "m2m-client-secret",
          name: "Acme Worker",
          app_type: "non_interactive",
          management_scopes: [
            "read:users",
            "create:users",
            "update:users",
            "delete:users",
            "read:roles",
            "create:role_members",
            "read:organizations",
            "create:organizations",
            "read:organization_members",
            "create:organization_members",
          ],
          client_grants: [{ audience: API, scopes: ["read:orders"] }],
        },
      ],
      apis: [
        {
          identifier: API,
          scopes: ["read:orders", "write:orders"],
          rbac: true,
          permissions_in_token: true,
          allow_offline_access: true,
        },
      ],
      roles: [
        {
          name: "admin",
          permissions: [
            { resource_server_identifier: API, permission_name: "read:orders" },
            { resource_server_identifier: API, permission_name: "write:orders" },
          ],
        },
        {
          name: "viewer",
          permissions: [{ resource_server_identifier: API, permission_name: "read:orders" }],
        },
      ],
      organizations: [{ name: "acme-staff", display_name: "Acme Staff" }],
      users: [
        {
          email: "ada@acme.test",
          password: "Analytical-1",
          name: "Ada Lovelace",
          email_verified: true,
          roles: ["admin"],
          organizations: ["acme-staff"],
        },
        {
          email: "grace@acme.test",
          password: "Compiler-1",
          name: "Grace Hopper",
          email_verified: true,
          roles: ["viewer"],
          mfa_secret: MFA_SECRET,
        },
        { email: "mallory@acme.test", password: "Mallory-1", blocked: true },
      ],
    },
  ],
}

let emulator: Emulator
let clock: ManualClock
let browser: LoginBrowser

const toEmulator = (url: string, { body, headers, method }: oidc.CustomFetchOptions) =>
  emulator.fetch(
    new Request(url, {
      body: body instanceof Uint8Array ? new Uint8Array(body) : (body ?? null),
      headers,
      method,
    }),
  )

async function discover(host = DOMAIN): Promise<oidc.Configuration> {
  return oidc.discovery(new URL(`https://${host}`), WEB.id, WEB.secret, undefined, {
    [oidc.customFetch]: toEmulator,
  })
}

async function authorization(config: oidc.Configuration, extra: Record<string, string> = {}) {
  const verifier = oidc.randomPKCECodeVerifier()
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: WEB.callback,
    scope: "openid profile email offline_access read:orders write:orders",
    audience: API,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state: "st-1",
    nonce: "n-1",
    ...extra,
  })

  return { url, verifier }
}

/** Opens `/authorize`, submits the login form, and returns the response that leaves the tenant. */
async function logIn(url: URL, email: string, password: string): Promise<Response> {
  const page = await browser.open(url)
  const html = await page.text()
  const state = /name="state" value="([^"]+)"/.exec(html)?.[1] ?? ""

  return browser.post(`https://${url.host}/u/login?state=${state}`, {
    state,
    username: email,
    password,
  })
}

async function tokensFor(config: oidc.Configuration, redirect: URL, verifier: string) {
  return oidc.authorizationCodeGrant(config, redirect, {
    pkceCodeVerifier: verifier,
    expectedState: "st-1",
    expectedNonce: "n-1",
  })
}

beforeEach(() => {
  clock = new ManualClock(new Date())
  emulator = createEmulator(auth0, { clock: clock.clock })
  seedAuth0(emulator.store, ACME)
  browser = new LoginBrowser((request) => emulator.fetch(request))
})

afterEach(async () => {
  await emulator.close()
})

describe("Auth0 sign-in", () => {
  it("logs in with PKCE, and the tokens carry the profile, roles, permissions and custom claims", async () => {
    const config = await discover()
    const { url, verifier } = await authorization(config)

    expect(url.origin).toBe(`https://${DOMAIN}`)

    const back = await logIn(url, "ada@acme.test", "Analytical-1")

    expect(back.status).toBe(302)

    const tokens = await tokensFor(config, locationOf(back), verifier)
    const claims = tokens.claims()

    expect(claims).toMatchObject({
      iss: ISSUER,
      sub: expect.stringMatching(/^auth0\|/),
      aud: WEB.id,
      email: "ada@acme.test",
      name: "Ada Lovelace",
      "https://acme.test/plan": "pro",
      "https://acme.test/roles": ["admin"],
    })
    expect(tokens.scope).toBe("openid profile email offline_access read:orders write:orders")
    expect(tokens.refresh_token).toBeDefined()

    const [, payload = ""] = tokens.access_token.split(".")
    const access = JSON.parse(Buffer.from(payload, "base64url").toString())

    expect(access).toMatchObject({
      aud: [API, `${ISSUER}userinfo`],
      permissions: ["read:orders", "write:orders"],
      azp: WEB.id,
    })
    expect(
      await oidc.fetchUserInfo(config, tokens.access_token, String(claims?.sub)),
    ).toMatchObject({ email: "ada@acme.test", email_verified: true })
    expect(auth0Tenant(emulator).logins("ada@acme.test")).toMatchObject([
      { method: "password", mfa: false, clientId: WEB.id },
    ])
  })

  it("only grants the API scopes a user's roles allow under RBAC", async () => {
    const config = await discover()
    const { url, verifier } = await authorization(config)
    const grace = await logIn(url, "grace@acme.test", "Compiler-1")
    const challenge = await browser.open(
      new URL(grace.headers.get("location") ?? "", `https://${DOMAIN}`),
    )
    const state = /name="state" value="([^"]+)"/.exec(await challenge.text())?.[1] ?? ""
    const back = await browser.post(`https://${DOMAIN}/u/mfa-otp-challenge?state=${state}`, {
      state,
      code: auth0OtpAt(MFA_SECRET, clock.clock()),
    })
    const tokens = await tokensFor(config, locationOf(back), verifier)

    expect(tokens.scope).toBe("openid profile email offline_access read:orders")
    expect(auth0Tenant(emulator).logins("grace@acme.test")[0]).toMatchObject({ mfa: true })
  })

  it("refuses a wrong one-time code and keeps the user on the challenge", async () => {
    const config = await discover()
    const { url } = await authorization(config)
    const grace = await logIn(url, "grace@acme.test", "Compiler-1")

    expect(grace.headers.get("location")).toMatch(/^\/u\/mfa-otp-challenge\?state=/)

    const state =
      new URL(grace.headers.get("location") ?? "", `https://${DOMAIN}`).searchParams.get("state") ??
      ""
    const wrong = await browser.post(`https://${DOMAIN}/u/mfa-otp-challenge?state=${state}`, {
      state,
      code: "000000",
    })

    expect(wrong.status).toBe(400)
    expect(await wrong.text()).toContain("The code you entered is invalid")
  })

  it("rotates refresh tokens, and a reused one revokes the whole family", async () => {
    const config = await discover()
    const { url, verifier } = await authorization(config)
    const first = await tokensFor(
      config,
      locationOf(await logIn(url, "ada@acme.test", "Analytical-1")),
      verifier,
    )
    const second = await oidc.refreshTokenGrant(config, first.refresh_token ?? "")

    expect(second.refresh_token).toBeDefined()
    expect(second.refresh_token).not.toBe(first.refresh_token)

    await expect(oidc.refreshTokenGrant(config, first.refresh_token ?? "")).rejects.toMatchObject({
      error: "invalid_grant",
      error_description: "Unknown or invalid refresh token.",
    })
    await expect(oidc.refreshTokenGrant(config, second.refresh_token ?? "")).rejects.toMatchObject({
      error: "invalid_grant",
    })
    expect(auth0Tenant(emulator).liveRefreshTokens(WEB.id)).toBe(0)
  })

  it("issues machine tokens by client grant, and refuses an API the client has no grant for", async () => {
    const m2m = await oidc.discovery(
      new URL(`https://${DOMAIN}`),
      "m2m-client-id",
      "m2m-client-secret",
      undefined,
      { [oidc.customFetch]: toEmulator },
    )
    const tokens = await oidc.clientCredentialsGrant(m2m, { audience: API })
    const [, payload = ""] = tokens.access_token.split(".")

    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({
      sub: "m2m-client-id@clients",
      gty: "client-credentials",
      scope: "read:orders",
      aud: API,
    })
    await expect(
      oidc.clientCredentialsGrant(m2m, { audience: "https://other.acme.test" }),
    ).rejects.toMatchObject({ error: "access_denied" })
  })

  it("answers through a custom domain with that domain as the issuer", async () => {
    const config = await discover("login.acme.test")
    const { url, verifier } = await authorization(config)
    const tokens = await tokensFor(
      config,
      locationOf(await logIn(url, "ada@acme.test", "Analytical-1")),
      verifier,
    )

    expect(tokens.claims()?.iss).toBe("https://login.acme.test/")
  })

  it("shows Auth0's errors: wrong password, blocked user, unknown callback, unverified email", async () => {
    const config = await discover()
    const { url } = await authorization(config)
    const wrong = await logIn(url, "ada@acme.test", "nope")

    expect(wrong.status).toBe(400)
    expect(await wrong.text()).toContain("Wrong email or password")

    const blocked = await logIn((await authorization(config)).url, "mallory@acme.test", "Mallory-1")

    expect(await blocked.text()).toContain("blocked")

    const mismatch = new URL(url)

    mismatch.searchParams.set("redirect_uri", "https://evil.test/callback")
    expect(await (await browser.open(mismatch)).text()).toContain("Callback URL mismatch.")
  })

  it("answers prompt=none with login_required without a session, and with a code once logged in", async () => {
    const config = await discover()
    const silent = await authorization(config, { prompt: "none" })
    const refused = locationOf(await browser.open(silent.url))

    expect(refused.searchParams.get("error")).toBe("login_required")

    await logIn((await authorization(config)).url, "ada@acme.test", "Analytical-1")

    const again = await authorization(config, { prompt: "none" })
    const back = locationOf(await browser.open(again.url))

    expect(back.searchParams.get("code")).toBeTruthy()
    expect(auth0Tenant(emulator).logins("ada@acme.test")[0]?.method).toBe("silent")
  })

  it("signs up a new user, who stays unverified until the verification link is opened", async () => {
    const config = await discover()
    const { url, verifier } = await authorization(config, { screen_hint: "signup" })
    const page = await browser.open(url)
    const state = /name="state" value="([^"]+)"/.exec(await page.text())?.[1] ?? ""

    expect(
      await (
        await browser.post(`https://${DOMAIN}/u/signup?state=${state}`, {
          state,
          username: "new@acme.test",
          password: "short",
        })
      ).text(),
    ).toContain("at least 8")

    const back = await browser.post(`https://${DOMAIN}/u/signup?state=${state}`, {
      state,
      username: "new@acme.test",
      password: "Long-enough-1",
    })
    const tokens = await tokensFor(config, locationOf(back), verifier)

    expect(tokens.claims()).toMatchObject({ email: "new@acme.test", email_verified: false })
    expect(auth0Tenant(emulator).logins("new@acme.test")[0]?.method).toBe("signup")
  })

  it("refuses unverified users when the tenant requires a verified email", async () => {
    seedAuth0(emulator.store, {
      tenants: [
        {
          domain: "strict.auth0.com",
          require_verified_email: true,
          clients: [
            {
              client_id: "strict-web",
              client_secret: "s",
              name: "Strict",
              callbacks: [WEB.callback],
            },
          ],
          users: [{ email: "eve@acme.test", password: "Unverified-1" }],
        },
      ],
    })

    const start = new URL("https://strict.auth0.com/authorize")

    start.search = new URLSearchParams({
      client_id: "strict-web",
      redirect_uri: WEB.callback,
      response_type: "code",
      scope: "openid",
      state: "s1",
    }).toString()

    const back = locationOf(await logIn(start, "eve@acme.test", "Unverified-1"))

    expect(back.searchParams.get("error")).toBe("access_denied")
    expect(back.searchParams.get("error_description")).toBe(
      "Please verify your email before logging in.",
    )
    expect(back.searchParams.get("state")).toBe("s1")
  })

  it("lets a logout return only to an allowed URL", async () => {
    const allowed = await browser.open(
      `https://${DOMAIN}/v2/logout?client_id=${WEB.id}&returnTo=${encodeURIComponent("https://app.acme.test/")}`,
    )

    expect(allowed.status).toBe(302)
    expect(allowed.headers.get("location")).toBe("https://app.acme.test/")

    const refused = await browser.open(
      `https://${DOMAIN}/v2/logout?client_id=${WEB.id}&returnTo=${encodeURIComponent("https://evil.test/")}`,
    )

    expect(refused.status).toBe(400)
    expect(await refused.text()).toContain("Allowed Logout URLs")
  })

  it("faults the app's calls but not the login pages", () => {
    expect(
      auth0OutboundFaults({ method: "POST", path: "/oauth/token" }).map((fault) =>
        "status" in fault ? fault.status : fault.kind,
      ),
    ).toEqual([429, 500, 503, "delay", "reset", "reset-after", 403])
    expect(auth0OutboundFaults({ method: "GET", path: "/.well-known/jwks.json" })).toHaveLength(3)
    expect(auth0OutboundFaults({ method: "POST", path: "/u/login" })).toEqual([])
    expect(
      auth0OutboundFaults({ method: "PATCH", path: "/api/v2/users/auth0%7C1" }).at(-1),
    ).toEqual({ kind: "reset-after" })
  })
})

const management = () =>
  new ManagementClient({
    domain: DOMAIN,
    clientId: "m2m-client-id",
    clientSecret: "m2m-client-secret",
    fetch: async (input, init) => emulator.fetch(new Request(input, init)),
  })

async function managementToken(scope?: string): Promise<string> {
  const m2m = await oidc.discovery(
    new URL(`https://${DOMAIN}`),
    "m2m-client-id",
    "m2m-client-secret",
    undefined,
    { [oidc.customFetch]: toEmulator },
  )

  return (
    await oidc.clientCredentialsGrant(m2m, {
      audience: `https://${DOMAIN}/api/v2/`,
      ...(scope === undefined ? {} : { scope }),
    })
  ).access_token
}

describe("Auth0 Management API", () => {
  it("creates, finds, updates and deletes users", async () => {
    const api = management()
    const created = await api.users.create({
      connection: "Username-Password-Authentication",
      email: "linus@acme.test",
      password: "Kernel-hacker-1",
      name: "Linus",
      user_metadata: { theme: "dark" },
    })

    expect(created).toMatchObject({
      email: "linus@acme.test",
      email_verified: false,
      user_metadata: { theme: "dark" },
    })

    const found = await api.users.list({ q: 'email:"linus@acme.test"', search_engine: "v3" })

    expect(found.data.map((user) => user.email)).toEqual(["linus@acme.test"])
    expect((await api.users.list({ q: "name:Ada*" })).data.map((user) => user.email)).toEqual([
      "ada@acme.test",
    ])
    expect(
      (await api.users.listUsersByEmail({ email: "grace@acme.test" })).map((user) => user.name),
    ).toEqual(["Grace Hopper"])

    const id = created.user_id ?? ""
    const updated = await api.users.update(id, {
      user_metadata: { theme: null, locale: "fi" },
      app_metadata: { plan: "pro" },
    })

    expect(updated).toMatchObject({
      user_metadata: { locale: "fi" },
      app_metadata: { plan: "pro" },
    })
    expect(updated.user_metadata).not.toHaveProperty("theme")

    await api.users.delete(id)
    await expect(api.users.get(id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("pages users with totals and rate-limit headers", async () => {
    const page = await emulator.fetch(
      new Request(`https://${DOMAIN}/api/v2/users?per_page=2&page=0&include_totals=true`, {
        headers: { authorization: `Bearer ${await managementToken()}` },
      }),
    )

    expect(await page.json()).toMatchObject({ start: 0, limit: 2, length: 2, total: 3 })
    expect(page.headers.get("x-ratelimit-limit")).toBe("50")
    expect(page.headers.get("x-ratelimit-remaining")).toBe("49")
  })

  it("assigns roles, which show up as the user's permissions", async () => {
    const api = management()
    const roles = await api.roles.list()
    const admin = roles.data.find((role) => role.name === "admin")
    const grace = auth0Tenant(emulator).user("grace@acme.test")

    await api.users.roles.assign(grace?.user_id ?? "", { roles: [admin?.id ?? ""] })

    const permissions = await api.users.permissions.list(grace?.user_id ?? "")

    expect(
      permissions.data
        .map((permission) => permission.permission_name)
        .toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(["read:orders", "write:orders"])
    expect(
      (await api.users.roles.list(grace?.user_id ?? "")).data
        .map((role) => role.name)
        .toSorted((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(["admin", "viewer"])
  })

  it("manages organizations and their members", async () => {
    const api = management()
    const org = await api.organizations.create({
      name: "acme-partners",
      display_name: "Acme Partners",
    })
    const ada = auth0Tenant(emulator).user("ada@acme.test")

    await api.organizations.members.create(org.id ?? "", { members: [ada?.user_id ?? ""] })

    expect(
      (await api.organizations.members.list(org.id ?? "")).data.map((member) => member.email),
    ).toEqual(["ada@acme.test"])
    expect((await api.organizations.getByName("acme-staff")).display_name).toBe("Acme Staff")
    await expect(api.organizations.create({ name: "acme-partners" })).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it("sends a verification email whose link verifies the user", async () => {
    const api = management()
    const user = await api.users.create({
      connection: "Username-Password-Authentication",
      email: "ken@acme.test",
      password: "Unix-pioneer-1",
    })
    const job = await api.jobs.verificationEmail.create({ user_id: user.user_id ?? "" })

    expect(job).toMatchObject({ type: "verification_email", status: "completed" })

    const [email] = auth0Tenant(emulator).emails("ken@acme.test")

    expect(email?.link).toMatch(/^https:\/\/acme\.us\.auth0\.com\/u\/email-verification\?ticket=/)
    expect(await (await browser.open(email?.link ?? "")).text()).toContain("verified")
    expect(auth0Tenant(emulator).user("ken@acme.test")?.email_verified).toBe(true)
  })

  it("answers Auth0's error shapes for a missing scope and a bad token", async () => {
    const refused = await emulator.fetch(
      new Request(`https://${DOMAIN}/api/v2/roles`, {
        headers: { authorization: `Bearer ${await managementToken("read:users")}` },
      }),
    )

    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({
      statusCode: 403,
      error: "Forbidden",
      message: "Insufficient scope, expected any of: read:roles",
      errorCode: "insufficient_scope",
    })

    const bad = await emulator.fetch(
      new Request(`https://${DOMAIN}/api/v2/users`, { headers: { authorization: "Bearer nope" } }),
    )

    expect(bad.status).toBe(401)
  })
})

describe("Auth0 social login", () => {
  it("signs in through the Google button, creating a google-oauth2 user", async () => {
    const googleEmulator = createEmulator(google, { clock: clock.clock })

    seedGoogle(googleEmulator.store, {
      users: [{ email: "tim@gmail.test", name: "Tim Berners-Lee" }],
      oauth_clients: [
        {
          client_id: "google-client",
          client_secret: "google-secret",
          name: "Acme login",
          redirect_uris: ["https://social.eu.auth0.com/login/callback"],
        },
      ],
    })
    seedAuth0(emulator.store, {
      tenants: [
        {
          domain: "social.eu.auth0.com",
          clients: [
            {
              client_id: "social-web",
              client_secret: "s",
              name: "Social",
              callbacks: [WEB.callback],
            },
          ],
          connections: [
            { name: "google-oauth2", client_id: "google-client", client_secret: "google-secret" },
          ],
        },
      ],
    })
    connectAuth0Upstream(emulator, async (request) => googleEmulator.fetch(request))

    try {
      const start = new URL("https://social.eu.auth0.com/authorize")

      start.search = new URLSearchParams({
        client_id: "social-web",
        redirect_uri: WEB.callback,
        response_type: "code",
        scope: "openid email",
        state: "s1",
      }).toString()

      const login = await (await browser.open(start)).text()

      expect(login).toContain("Continue with Google")

      const state = /name="state" value="([^"]+)"/.exec(login)?.[1] ?? ""
      const toGoogle = locationOf(
        await browser.open(
          `https://social.eu.auth0.com/authorize/social?state=${state}&connection=google-oauth2`,
        ),
      )

      expect(toGoogle.host).toBe("accounts.google.com")

      const consentPage = await (await googleEmulator.fetch(new Request(toGoogle))).text()
      const request = /name="request" value="([^"]+)"/.exec(consentPage)?.[1] ?? ""
      const user = /name="user" value="([^"]+)"/.exec(consentPage)?.[1] ?? ""
      const fromGoogle = await googleEmulator.fetch(
        new Request("https://accounts.google.com/o/oauth2/v2/auth/callback", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ request, user }),
        }),
      )
      const back = locationOf(await browser.open(locationOf(fromGoogle)))

      expect(back.origin + back.pathname).toBe(WEB.callback)
      expect(back.searchParams.get("code")).toBeTruthy()
      expect(auth0Tenant(emulator, "social.eu.auth0.com").user("tim@gmail.test")?.user_id).toMatch(
        /^google-oauth2\|/,
      )
    } finally {
      await googleEmulator.close()
    }
  })
})
