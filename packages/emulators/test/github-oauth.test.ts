import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { githubSignIns } from "../src/github/index.ts"
import { ManualClock } from "../src/time.ts"
import { BOT, githubWith, OAUTH_APP, octokitFor, payloadOf, refusal } from "./github-api.ts"

type Emulator = ReturnType<typeof githubWith>

/** Opens the authorization page and picks `login`; returns where the browser was sent back to. */
async function authorize(
  emulator: Emulator,
  query: Record<string, string>,
  login: string,
): Promise<URL> {
  const page = await emulator.fetch(
    new Request(`https://github.com/login/oauth/authorize?${new URLSearchParams(query)}`),
  )
  const html = await page.text()
  const request = /name="request" value="([^"]+)"/.exec(html)?.[1] ?? ""
  const back = await emulator.fetch(
    new Request("https://github.com/login/oauth/authorize/choose", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request, user: login }),
    }),
  )

  return new URL(back.headers.get("location") ?? "")
}

/** Posts to the token endpoint and reads the answer as JSON. */
async function token(
  emulator: Emulator,
  fields: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await emulator.fetch(
    new Request("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(fields),
    }),
  )

  expect(response.status).toBe(200)

  return payloadOf({ url: "", headers: {}, body: await response.text() })
}

const oauthApp = { client_id: OAUTH_APP.clientId, client_secret: OAUTH_APP.clientSecret }

describe("Signing in with GitHub", () => {
  it("signs a person in to an OAuth App and gives a token with their scopes", async () => {
    const emulator = githubWith()
    const back = await authorize(
      emulator,
      { client_id: OAUTH_APP.clientId, scope: "read:user user:email", state: "s1" },
      "ada",
    )

    expect(back.origin + back.pathname).toBe(OAUTH_APP.callback)
    expect(back.searchParams.get("state")).toBe("s1")

    const answer = await token(emulator, { ...oauthApp, code: back.searchParams.get("code") ?? "" })

    expect(answer).toMatchObject({ token_type: "bearer", scope: "read:user,user:email" })
    expect(String(answer.access_token)).toMatch(/^gho_/)

    const ada = octokitFor(emulator, String(answer.access_token))

    expect((await ada.rest.users.getAuthenticated()).data).toMatchObject({
      login: "ada",
      name: "Ada Lovelace",
    })
    expect(
      (await ada.rest.users.listEmailsForAuthenticatedUser()).data.map(
        (e) => `${e.email} ${e.primary}`,
      ),
    ).toEqual(["ada@danwo.test true", "ada@work.test false"])
    expect(githubSignIns(emulator).latest()).toMatchObject({
      email: "ada@danwo.test",
      clientId: OAUTH_APP.clientId,
      redeemed: true,
    })
  })

  it("answers token errors with HTTP 200, and form-encoded unless JSON was asked for", async () => {
    const emulator = githubWith()
    const back = await authorize(emulator, { client_id: OAUTH_APP.clientId }, "ada")
    const code = back.searchParams.get("code") ?? ""

    expect(await token(emulator, { ...oauthApp, client_secret: "wrong", code })).toMatchObject({
      error: "incorrect_client_credentials",
    })
    expect((await token(emulator, { ...oauthApp, code })).access_token).toBeDefined()
    expect(await token(emulator, { ...oauthApp, code })).toMatchObject({
      error: "bad_verification_code",
    })

    const form = await emulator.fetch(
      new Request("https://github.com/login/oauth/access_token", {
        method: "POST",
        body: new URLSearchParams({ ...oauthApp, code: "nope" }),
      }),
    )

    expect(new URLSearchParams(await form.text()).get("error")).toBe("bad_verification_code")
  })

  it("sends a mismatched redirect back to the registered callback with an error, and refuses an unknown app", async () => {
    const emulator = githubWith()
    const query = new URLSearchParams({
      client_id: OAUTH_APP.clientId,
      redirect_uri: "https://evil.test/cb",
      state: "s2",
    })
    const page = await emulator.fetch(
      new Request(`https://github.com/login/oauth/authorize?${query}`),
    )
    const back = new URL(page.headers.get("location") ?? "")

    expect(back.origin + back.pathname).toBe(OAUTH_APP.callback)
    expect(back.searchParams.get("error")).toBe("redirect_uri_mismatch")
    expect(back.searchParams.get("state")).toBe("s2")
    expect(
      (await emulator.fetch(new Request("https://github.com/login/oauth/authorize?client_id=nope")))
        .status,
    ).toBe(404)

    const sub = await authorize(
      emulator,
      { client_id: OAUTH_APP.clientId, redirect_uri: `${OAUTH_APP.callback}/deeper` },
      "ada",
    )

    expect(sub.searchParams.get("code")).toBeTruthy()
  })

  it("checks PKCE, and returns access_denied when the person cancels", async () => {
    const emulator = githubWith()
    const verifier = "a-very-long-pkce-verifier-for-the-github-emulator-test"
    const challenge = createHash("sha256").update(verifier).digest("base64url")
    const back = await authorize(
      emulator,
      { client_id: OAUTH_APP.clientId, code_challenge: challenge, code_challenge_method: "S256" },
      "ada",
    )
    const code = back.searchParams.get("code") ?? ""

    expect(await token(emulator, { ...oauthApp, code, code_verifier: "wrong" })).toMatchObject({
      error: "bad_verification_code",
    })
    expect(
      (await token(emulator, { ...oauthApp, code, code_verifier: verifier })).access_token,
    ).toBeDefined()

    const page = await (
      await emulator.fetch(
        new Request(`https://github.com/login/oauth/authorize?client_id=${OAUTH_APP.clientId}`),
      )
    ).text()
    const request = /name="request" value="([^"]+)"/.exec(page)?.[1] ?? ""
    const denied = await emulator.fetch(
      new Request("https://github.com/login/oauth/authorize/choose", {
        method: "POST",
        body: new URLSearchParams({ request, deny: "1" }),
      }),
    )

    expect(new URL(denied.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "access_denied",
    )
  })

  it("gives a GitHub App expiring user tokens with a single-use refresh token", async () => {
    const clock = new ManualClock(new Date())
    const emulator = githubWith({}, { clock: clock.clock })
    const back = await authorize(
      emulator,
      { client_id: BOT.clientId, redirect_uri: BOT.callback },
      "ada",
    )
    const first = await token(emulator, {
      client_id: BOT.clientId,
      client_secret: BOT.clientSecret,
      code: back.searchParams.get("code") ?? "",
    })

    expect(first).toMatchObject({
      expires_in: 28_800,
      refresh_token_expires_in: 15_897_600,
      scope: "",
    })
    expect(String(first.access_token)).toMatch(/^ghu_/)

    const refresh = {
      client_id: BOT.clientId,
      client_secret: BOT.clientSecret,
      grant_type: "refresh_token",
      refresh_token: String(first.refresh_token),
    }
    const second = await token(emulator, refresh)

    expect(String(second.access_token)).toMatch(/^ghu_/)
    expect(await token(emulator, refresh)).toMatchObject({ error: "bad_refresh_token" })
    expect(
      await refusal(octokitFor(emulator, String(first.access_token)).rest.users.getAuthenticated()),
    ).toMatchObject({ status: 401 })

    clock.advance(8 * 3600 * 1000 + 1000)
    expect(
      await refusal(
        octokitFor(emulator, String(second.access_token)).rest.users.getAuthenticated(),
      ),
    ).toMatchObject({ status: 401 })
  })

  it("acts with a GitHub App user token only where the app is installed", async () => {
    const emulator = githubWith()
    const back = await authorize(
      emulator,
      { client_id: BOT.clientId, redirect_uri: BOT.callback },
      "ada",
    )
    const answer = await token(emulator, {
      client_id: BOT.clientId,
      client_secret: BOT.clientSecret,
      code: back.searchParams.get("code") ?? "",
    })
    const ada = octokitFor(emulator, String(answer.access_token))

    expect(
      (await ada.rest.issues.create({ owner: "acme", repo: "widgets", title: "Via the app" })).data
        .user?.login,
    ).toBe("ada")
    expect(
      await refusal(ada.rest.issues.create({ owner: "ada", repo: "notes", title: "x" })),
    ).toEqual({ status: 403, message: "Resource not accessible by integration" })
    expect(await refusal(ada.rest.users.listEmailsForAuthenticatedUser())).toMatchObject({
      status: 404,
    })
  })
})
