/**
 * Clerk's Frontend API scenario, as the browser SDK drives a development instance: the dev browser
 * handshake, the environment and client, a sign-up and a sign-in by emailed code, and the session
 * token they end in. Clerk's test addresses (`…+clerk_test@example.com`, code 424242) keep a live
 * run from sending mail. The token's claims and header are compared by name, and the token must
 * verify with `@clerk/backend` against the target's own signing keys.
 */
import { createPublicKey } from "node:crypto"

import { verifyToken } from "@clerk/backend"

import type { Answer, Scenario, ScenarioContext } from "../scenario.ts"
import { asJsonObject, isJsonArray, type Json } from "../shape.ts"
import { credential } from "../target.ts"
import { backend, CLERK_LITERALS, testEmail } from "./clerk-backend.ts"

/** The origin the browser calls from; tokens carry it as `azp`. */
const ORIGIN = "http://localhost:3000"
/** The browser SDK version the Frontend API is asked for, as clerk-js sends it. */
const JS_VERSION = "5.0.0"
/** The code Clerk's development instances accept for test addresses. */
const TEST_CODE = "424242"

const OPTIONS = {
  literals: [...CLERK_LITERALS, "response.status", "**.sign_in.status", "**.sign_up.status"],
  maps: ["**.public_metadata", "**.unsafe_metadata", "**.private_metadata"],
}

/** The Frontend API's host, encoded in the publishable key (`pk_test_` + base64 of `host$`). */
export function frontendHost(publishableKey: string): string {
  const encoded = publishableKey.replace(/^pk_(test|live)_/, "")

  return Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "")
}

/** A browser-side session against one target's Frontend API. */
class Browser {
  readonly context: ScenarioContext
  private readonly host: string
  private devBrowser = ""

  constructor(context: ScenarioContext) {
    this.context = context
    this.host = frontendHost(credential(context.target, "publishable"))
  }

  private url(path: string): string {
    const query = new URLSearchParams({ _clerk_js_version: JS_VERSION })

    if (this.devBrowser !== "") query.set("__clerk_db_jwt", this.devBrowser)

    return `https://${this.host}${path}?${query}`
  }

  /**
   * Starts the dev browser: development instances key the client on it, not a cookie. Its id is
   * sent as `__clerk_db_jwt`, as ClerkJS does; it is read from an unrecorded call (recorded answers
   * have secrets taken out), and a second call records the answer's shape.
   */
  async start(): Promise<void> {
    const request = () =>
      new Request(`https://${this.host}/v1/dev_browser`, {
        method: "POST",
        headers: { origin: ORIGIN },
      })
    const raw: unknown = await (await this.context.target.send(request())).json()
    const id = typeof raw === "object" && raw !== null && "id" in raw ? raw.id : undefined

    if (typeof id !== "string") throw new Error("the dev browser answer has no id")

    this.devBrowser = id
    await this.context.step("start the dev browser", request())
  }

  /** Sends a request without recording it, for answers whose secrets a scenario needs. */
  async raw(path: string, values: Readonly<Record<string, string>> = {}): Promise<unknown> {
    const answer = await this.context.target.send(this.postRequest(path, values))

    return answer.json()
  }

  private postRequest(path: string, values: Readonly<Record<string, string>>): Request {
    return new Request(this.url(path), {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values).toString(),
    })
  }

  get(step: string, path: string): Promise<Answer> {
    return this.context.step(
      step,
      new Request(this.url(path), { headers: { origin: ORIGIN } }),
      OPTIONS,
    )
  }

  post(step: string, path: string, values: Readonly<Record<string, string>> = {}): Promise<Answer> {
    return this.context.step(step, this.postRequest(path, values), OPTIONS)
  }

  signOut(): Promise<Answer> {
    return this.context.step(
      "sign out",
      new Request(this.url("/v1/client/sessions"), {
        method: "DELETE",
        headers: { origin: ORIGIN },
      }),
      OPTIONS,
    )
  }
}

/** A string at `response.<name>` of a Frontend API answer. */
function responseField(answer: Answer, name: string): string {
  const value = asJsonObject(asJsonObject(answer.body)?.["response"])?.[name]

  if (typeof value !== "string") throw new Error(`expected the answer's response to have ${name}`)

  return value
}

/** The id of the sign-in's email-code factor. */
function emailCodeFactor(answer: Answer): string {
  const factors = asJsonObject(asJsonObject(answer.body)?.["response"])?.["supported_first_factors"]
  const list: readonly Json[] = factors !== undefined && isJsonArray(factors) ? factors : []
  const factor = list
    .map((item) => asJsonObject(item))
    .find((item) => item?.["strategy"] === "email_code")
  const id = factor?.["email_address_id"]

  if (typeof id !== "string") throw new Error("the sign-in offers no email code factor")

  return id
}

/** A JWT part, decoded: the header (0) or the claims (1). */
function jwtPart(jwt: string, index: 0 | 1): Record<string, unknown> {
  const decoded: unknown = JSON.parse(
    Buffer.from(jwt.split(".")[index] ?? "", "base64url").toString("utf8"),
  )

  return typeof decoded === "object" && decoded !== null ? { ...decoded } : {}
}

/** A JWT part's names, sorted, as one fact: names are API, values are not. */
function partNames(jwt: string, index: 0 | 1): string {
  return Object.keys(jwtPart(jwt, index)).toSorted().join(" ")
}

/** One claim of a JWT. */
function claimOf(jwt: string, name: string): unknown {
  return jwtPart(jwt, 1)[name]
}

/** The target's signing key with id `kid`, as a PEM, from the Backend or Frontend API's key set. */
async function signingKeyPem(context: ScenarioContext, kid: unknown): Promise<string> {
  const host = frontendHost(credential(context.target, "publishable"))
  const sets = await Promise.all(
    [backend(context, "GET", "/jwks"), new Request(`https://${host}/.well-known/jwks.json`)].map(
      async (request) => {
        const body: unknown = await (await context.target.send(request)).json()
        const keys = typeof body === "object" && body !== null && "keys" in body ? body.keys : []

        return Array.isArray(keys) ? keys : []
      },
    ),
  )
  const list: unknown[] = sets.flat()
  const key = list.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "kid" in candidate &&
      candidate.kid === kid,
  )

  if (typeof key !== "object" || key === null)
    throw new Error("the target has no key the token names")

  return createPublicKey({ key: { ...key }, format: "jwk" })
    .export({ type: "spki", format: "pem" })
    .toString()
}

/** Records the session token's claim and header names, and whether it verifies. */
async function checkToken(context: ScenarioContext, jwt: string): Promise<void> {
  context.fact("session token claims", partNames(jwt, 1))
  context.fact("session token header", partNames(jwt, 0))

  context.fact("the session token's azp is the calling origin", claimOf(jwt, "azp") === ORIGIN)

  const verified = await verifyToken(jwt, {
    jwtKey: await signingKeyPem(context, jwtPart(jwt, 0)["kid"]),
  }).then(
    () => true,
    () => false,
  )

  context.fact("the session token verifies with @clerk/backend", verified)
}

/** Signs up a new test address by emailed code; resolves to the new session's id. */
async function signUp(browser: Browser, email: string): Promise<{ session: string; user: string }> {
  const started = await browser.post("sign up with an email", "/v1/client/sign_ups", {
    email_address: email,
  })
  const id = responseField(started, "id")

  await browser.post("send the sign-up code", `/v1/client/sign_ups/${id}/prepare_verification`, {
    strategy: "email_code",
  })

  const done = await browser.post(
    "enter the sign-up code",
    `/v1/client/sign_ups/${id}/attempt_verification`,
    {
      strategy: "email_code",
      code: TEST_CODE,
    },
  )

  return {
    session: responseField(done, "created_session_id"),
    user: responseField(done, "created_user_id"),
  }
}

/** Signs the address in by emailed code. */
async function signIn(browser: Browser, email: string): Promise<void> {
  const started = await browser.post("sign in with the email", "/v1/client/sign_ins", {
    identifier: email,
  })
  const id = responseField(started, "id")

  await browser.post("send the sign-in code", `/v1/client/sign_ins/${id}/prepare_first_factor`, {
    strategy: "email_code",
    email_address_id: emailCodeFactor(started),
  })
  await browser.post("enter the sign-in code", `/v1/client/sign_ins/${id}/attempt_first_factor`, {
    strategy: "email_code",
    code: TEST_CODE,
  })
}

const browserFlow: Scenario = {
  name: "frontend: dev browser, sign-up and sign-in by email code, session token",
  async run(context) {
    const browser = new Browser(context)
    const email = testEmail(context, "browser")

    await browser.start()
    await browser.get("read the environment", "/v1/environment")
    await browser.get("read the client", "/v1/client")

    const { session, user } = await signUp(browser, email)

    context.cleanup(() => context.target.send(backend(context, "DELETE", `/users/${user}`)))

    const tokens = `/v1/client/sessions/${session}/tokens`
    const minted = await browser.raw(tokens)
    const jwt =
      typeof minted === "object" && minted !== null && "jwt" in minted ? minted.jwt : undefined

    if (typeof jwt !== "string") throw new Error("the token answer has no jwt")

    await browser.post("mint the session token", tokens)
    await checkToken(context, jwt)
    await browser.signOut()
    await signIn(browser, email)
    await browser.post("sign in with an unknown email", "/v1/client/sign_ins", {
      identifier: testEmail(context, "nobody"),
    })
  },
}

/** The Frontend API scenarios. */
export const CLERK_FRONTEND_SCENARIOS: readonly Scenario[] = [browserFlow]
