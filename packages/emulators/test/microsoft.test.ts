import { createHash, randomBytes } from "node:crypto"

import {
  ConfidentialClientApplication,
  type INetworkModule,
  type NetworkRequestOptions,
  type NetworkResponse,
} from "@azure/msal-node"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { microsoft, microsoftOutboundFaults, seedMicrosoft } from "../src/microsoft/index.ts"

const CLIENT_ID = "6731de76-14a6-49ae-97bc-6eba6914391e"
const CLIENT_SECRET = "Qx~8Q~app-secret"
const REDIRECT_URI = "https://app.danwo.test/auth/microsoft/callback"
const WORK_TENANT = "72f988bf-86f1-41af-91ab-2d7cd011db47"

let emulator: Emulator

async function toNetwork<T>(response: Response): Promise<NetworkResponse<T>> {
  const body: T = JSON.parse(await response.text())

  return { headers: Object.fromEntries(response.headers), body, status: response.status }
}

/** MSAL's network client, sent to the emulator: the URLs stay Microsoft's real ones. */
const networkClient: INetworkModule = {
  async sendGetRequestAsync<T>(url: string, options?: NetworkRequestOptions) {
    return toNetwork<T>(await emulator.fetch(new Request(url, { headers: options?.headers ?? {} })))
  },
  async sendPostRequestAsync<T>(url: string, options?: NetworkRequestOptions) {
    return toNetwork<T>(
      await emulator.fetch(
        new Request(url, {
          method: "POST",
          headers: options?.headers ?? {},
          body: options?.body ?? null,
        }),
      ),
    )
  },
}

function msal(authority = "common", secret = CLIENT_SECRET) {
  return new ConfidentialClientApplication({
    auth: {
      clientId: CLIENT_ID,
      clientSecret: secret,
      authority: `https://login.microsoftonline.com/${authority}`,
    },
    system: { networkClient },
  })
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url")

  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") }
}

/** Plays the browser: opens the authorization URL, picks `email`'s account, returns the redirect. */
async function signIn(url: string, email: string): Promise<URL> {
  const html = await (await emulator.fetch(new Request(url))).text()
  const request = /name="request" value="([^"]+)"/.exec(html)?.[1] ?? ""
  const item = html.split("<li>").find((li) => li.includes(email)) ?? ""
  const user = /name="user" value="([^"]+)"/.exec(item)?.[1] ?? ""
  const action = /<form method="post" action="([^"]+)"/.exec(html)?.[1] ?? ""
  const back = await emulator.fetch(
    new Request(new URL(action, url), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request, user }),
    }),
  )

  expect(back.status).toBe(302)

  return new URL(back.headers.get("location") ?? "")
}

async function codeFlow(app: ConfidentialClientApplication, email: string, authority = "common") {
  const { verifier, challenge } = pkce()
  const url = await app.getAuthCodeUrl({
    scopes: ["User.Read"],
    redirectUri: REDIRECT_URI,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
    state: "st-1",
    authority: `https://login.microsoftonline.com/${authority}`,
  })
  const callback = await signIn(url, email)

  return { callback, verifier }
}

function redeem(app: ConfidentialClientApplication, callback: URL, verifier: string) {
  return app.acquireTokenByCode({
    code: callback.searchParams.get("code") ?? "",
    scopes: ["User.Read"],
    redirectUri: REDIRECT_URI,
    codeVerifier: verifier,
  })
}

const page = async (tenant: string) => (await authorize({}, tenant)).text()

/** Opens the authorization page directly, as a browser would. */
function authorize(params: Record<string, string>, tenant = "common") {
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid profile",
    ...params,
  })

  return emulator.fetch(
    new Request(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${query}`),
  )
}

beforeEach(() => {
  emulator = createEmulator(microsoft)
  seedMicrosoft(emulator.store, {
    users: [
      { email: "ada@outlook.com", name: "Ada Lovelace" },
      { email: "grace@contoso.test", name: "Grace Hopper", tenant_id: WORK_TENANT },
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

describe("sign-in with MSAL", () => {
  it("runs the code flow with PKCE and calls Graph /me with the token", async () => {
    const app = msal()
    const { callback, verifier } = await codeFlow(app, "grace@contoso.test")

    expect(callback.searchParams.get("state")).toBe("st-1")
    expect(callback.searchParams.get("client_info")).toBeTruthy()

    const result = await redeem(app, callback, verifier)

    expect(result.account).toMatchObject({ username: "grace@contoso.test", tenantId: WORK_TENANT })
    expect(result.idTokenClaims).toMatchObject({
      aud: CLIENT_ID,
      iss: `https://login.microsoftonline.com/${WORK_TENANT}/v2.0`,
      tid: WORK_TENANT,
      ver: "2.0",
      name: "Grace Hopper",
    })

    const me = await emulator.fetch(
      new Request("https://graph.microsoft.com/v1.0/me", {
        headers: { authorization: `Bearer ${result.accessToken}` },
      }),
    )

    expect(await me.json()).toMatchObject({
      displayName: "Grace Hopper",
      mail: "grace@contoso.test",
      userPrincipalName: "grace@contoso.test",
      id: result.account?.localAccountId,
    })
  })

  it("refreshes silently with the cached refresh token", async () => {
    const app = msal()
    const { callback, verifier } = await codeFlow(app, "ada@outlook.com")
    const first = await redeem(app, callback, verifier)
    const [account] = await app.getTokenCache().getAllAccounts()

    if (!account) throw new Error("MSAL cached no account")
    const refreshed = await app.acquireTokenSilent({
      account,
      scopes: ["User.Read"],
      forceRefresh: true,
    })

    expect(refreshed.accessToken).not.toBe(first.accessToken)
    expect(refreshed.account?.username).toBe("ada@outlook.com")
  })

  it("refuses a wrong PKCE verifier, a reused code and a wrong secret, as MSAL parses them", async () => {
    const app = msal()
    const { callback, verifier } = await codeFlow(app, "ada@outlook.com")

    await expect(redeem(app, callback, pkce().verifier)).rejects.toMatchObject({
      errorCode: "invalid_grant",
      errorMessage: expect.stringContaining("AADSTS501481"),
    })
    await redeem(app, callback, verifier)
    await expect(redeem(app, callback, verifier)).rejects.toMatchObject({
      errorCode: "invalid_grant",
      errorMessage: expect.stringContaining("AADSTS54005"),
    })

    const wrong = msal("common", "wrong-secret")
    const again = await codeFlow(wrong, "ada@outlook.com")

    await expect(redeem(wrong, again.callback, again.verifier)).rejects.toMatchObject({
      errorCode: "invalid_client",
      errorMessage: expect.stringContaining("AADSTS7000215"),
    })
  })

  it("rejects an expired or missing Graph token with InvalidAuthenticationToken", async () => {
    const res = await emulator.fetch(new Request("https://graph.microsoft.com/v1.0/me"))

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: "InvalidAuthenticationToken" } })
  })
})

describe("the authorization page", () => {
  it("offers only the accounts the tenant path allows", async () => {
    expect(await page("consumers")).toContain("ada@outlook.com")
    expect(await page("consumers")).not.toContain("grace@contoso.test")
    expect(await page("organizations")).not.toContain("ada@outlook.com")
    expect(await page(WORK_TENANT)).toContain("grace@contoso.test")
    expect(await page("common")).toContain("Continue as Ada Lovelace")
  })

  it("refuses an unregistered redirect URI and an unknown client with their AADSTS codes", async () => {
    const mismatch = await authorize({ redirect_uri: "https://evil.test/cb" })
    const unknown = await authorize({ client_id: "00000000-0000-0000-0000-000000000000" })

    expect(await mismatch.text()).toContain("AADSTS50011")
    expect(await unknown.text()).toContain("AADSTS700016")

    const noScope = await authorize({ scope: "" })
    const location = new URL(noScope.headers.get("location") ?? "")

    expect(location.searchParams.get("error")).toBe("invalid_request")
  })

  it("discovers per tenant and serves the keys MSAL and openid-client fetch", async () => {
    const config = await (
      await emulator.fetch(
        new Request(
          `https://login.microsoftonline.com/${WORK_TENANT}/v2.0/.well-known/openid-configuration`,
        ),
      )
    ).json()

    expect(config).toMatchObject({
      issuer: `https://login.microsoftonline.com/${WORK_TENANT}/v2.0`,
      token_endpoint: `https://login.microsoftonline.com/${WORK_TENANT}/oauth2/v2.0/token`,
      userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
    })

    const keys = await (
      await emulator.fetch(
        new Request("https://login.microsoftonline.com/common/discovery/v2.0/keys"),
      )
    ).json()

    expect(keys).toMatchObject({
      keys: [{ kty: "RSA", use: "sig", cloud_instance_name: "microsoftonline.com" }],
    })
    expect(keys.keys[0]).not.toHaveProperty("alg")
  })
})

describe("microsoftOutboundFaults", () => {
  it("faults the token call and Graph, and leaves the browser's requests alone", () => {
    expect(
      microsoftOutboundFaults({ method: "POST", path: "/common/oauth2/v2.0/token" }),
    ).toHaveLength(6)
    expect(microsoftOutboundFaults({ method: "GET", path: "/v1.0/me" })).toHaveLength(3)
    expect(
      microsoftOutboundFaults({ method: "GET", path: "/common/oauth2/v2.0/authorize" }),
    ).toEqual([])
  })
})
