import { verifyToken } from "@clerk/backend"
import { afterEach, describe, expect, it } from "vitest"

import { clerkInstance, clerkOutboundFaults } from "../src/clerk/index.ts"
import { clerkTestbed } from "./clerk-client.ts"

const ORIGIN = "http://127.0.0.1:4100"
const FAPI = "https://danwo-app.clerk.accounts.dev"

let bed: ReturnType<typeof clerkTestbed>

/** The value at `path` inside a JSON answer. */
function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      current !== null && typeof current === "object" ? Reflect.get(current, key) : undefined,
    value,
  )
}

/** The string at `path` inside a JSON answer. */
function text(value: unknown, ...path: (string | number)[]): string {
  return String(at(value, ...path))
}

/** The statuses (or kinds) of the faults the matrix plans for a call. */
function statuses(path: string) {
  return clerkOutboundFaults({ method: "POST", path }).map((f) =>
    "status" in f ? f.status : f.kind,
  )
}

afterEach(() => bed.close())

/** A ClerkJS-style Frontend API call: form body, the dev browser in the query, the app's origin. */
async function call(
  path: string,
  options: { method?: string; devBrowser?: string; form?: Record<string, string> } = {},
) {
  const url = new URL(path, FAPI)

  if (options.devBrowser !== undefined) url.searchParams.set("__clerk_db_jwt", options.devBrowser)

  const response = await bed.emulator.fetch(
    new Request(url, {
      method: options.method ?? "GET",
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      ...(options.form && { body: new URLSearchParams(options.form).toString() }),
    }),
  )

  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as unknown,
  }
}

/** A new dev browser, as ClerkJS makes on its first load. */
async function devBrowser(): Promise<string> {
  return text((await call("/v1/dev_browser", { method: "POST" })).body, "id")
}

describe("Clerk Frontend API", () => {
  it("needs a dev browser, and answers with the app's origin allowed", async () => {
    bed = clerkTestbed()

    const anonymous = await call("/v1/client")

    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toMatchObject({ errors: [{ code: "dev_browser_unauthenticated" }] })
    expect(anonymous.headers.get("access-control-allow-origin")).toBe(ORIGIN)

    const dvb = await devBrowser()
    const client = await call("/v1/client", { devBrowser: dvb })

    expect(at(client.body, "response")).toMatchObject({
      object: "client",
      sessions: [],
      sign_in: null,
    })

    const environment = await call("/v1/environment?_method=PATCH", {
      method: "POST",
      devBrowser: dvb,
    })

    expect(environment.body).toMatchObject({
      user_settings: { attributes: { password: { enabled: true } } },
      display_config: { instance_environment_type: "development" },
    })
  })

  it("signs in with a password and mints session tokens the backend verifies", async () => {
    bed = clerkTestbed({ users: [{ email: "ada@danwo.test", password: "s3cret-pass" }] })

    const dvb = await devBrowser()
    const created = await call("/v1/client/sign_ins", {
      method: "POST",
      devBrowser: dvb,
      form: { identifier: "ada@danwo.test" },
    })

    const signInId = text(created.body, "response", "id")

    expect(created.body).toMatchObject({
      response: {
        status: "needs_first_factor",
        supported_first_factors: [{ strategy: "password" }, { strategy: "email_code" }],
      },
      client: { sign_in: { id: signInId } },
    })

    const attempt = `/v1/client/sign_ins/${signInId}/attempt_first_factor`
    const wrong = await call(attempt, {
      method: "POST",
      devBrowser: dvb,
      form: { strategy: "password", password: "nope" },
    })

    expect(wrong.status).toBe(422)
    expect(wrong.body).toMatchObject({
      errors: [{ code: "form_password_incorrect", meta: { param_name: "password" } }],
    })

    const done = await call(attempt, {
      method: "POST",
      devBrowser: dvb,
      form: { strategy: "password", password: "s3cret-pass" },
    })
    const sessionId = text(done.body, "response", "created_session_id")

    expect(done.body).toMatchObject({
      response: { status: "complete" },
      client: {
        last_active_session_id: sessionId,
        sessions: [{ user: { email_addresses: [{ email_address: "ada@danwo.test" }] } }],
      },
    })

    const token = await call(`/v1/client/sessions/${sessionId}/tokens`, {
      method: "POST",
      devBrowser: dvb,
    })
    const claims = await verifyToken(text(token.body, "jwt"), { secretKey: bed.secretKey })

    expect(claims).toMatchObject({ sid: sessionId, azp: ORIGIN, iss: FAPI })

    expect(clerkInstance(bed.emulator).revokeSessions("ada@danwo.test")).toBe(1)

    const revoked = await call(`/v1/client/sessions/${sessionId}/tokens`, {
      method: "POST",
      devBrowser: dvb,
    })

    expect(revoked.status).toBe(401)
    expect(revoked.body).toMatchObject({ errors: [{ code: "signed_out" }] })
    expect(
      at((await call("/v1/client", { devBrowser: dvb })).body, "response", "sessions"),
    ).toEqual([])
  })

  it("signs up with an emailed code and signs the new user in", async () => {
    bed = clerkTestbed()

    const dvb = await devBrowser()
    const created = await call("/v1/client/sign_ups", {
      method: "POST",
      devBrowser: dvb,
      form: { email_address: "grace@danwo.test", password: "long-enough" },
    })
    const id = text(created.body, "response", "id")

    expect(at(created.body, "response")).toMatchObject({
      status: "missing_requirements",
      unverified_fields: ["email_address"],
      missing_fields: [],
    })

    await call(`/v1/client/sign_ups/${id}/prepare_verification`, {
      method: "POST",
      devBrowser: dvb,
      form: { strategy: "email_code" },
    })

    const code = await clerkInstance(bed.emulator).code("grace@danwo.test")
    const verify = `/v1/client/sign_ups/${id}/attempt_verification`
    const wrong = await call(verify, {
      method: "POST",
      devBrowser: dvb,
      form: { strategy: "email_code", code: code === "000000" ? "111111" : "000000" },
    })

    expect(wrong.body).toMatchObject({ errors: [{ code: "form_code_incorrect" }] })

    const done = await call(verify, {
      method: "POST",
      devBrowser: dvb,
      form: { strategy: "email_code", code },
    })

    expect(done.body).toMatchObject({
      response: {
        status: "complete",
        created_user_id: clerkInstance(bed.emulator).user("grace@danwo.test")?.id,
      },
    })
    expect(at(done.body, "client", "sessions")).toHaveLength(1)

    const taken = await call("/v1/client/sign_ups", {
      method: "POST",
      devBrowser: dvb,
      form: { email_address: "grace@danwo.test" },
    })

    expect(taken.body).toMatchObject({ errors: [{ code: "form_identifier_exists" }] })
  })

  it("fails only ClerkJS's token refresh among the browser's calls", () => {
    bed = clerkTestbed()

    expect(statuses("/v1/client/sessions/sess_1/tokens")).toEqual([500, 503])
    expect(statuses("/v1/client/sign_ins")).toEqual([])
    expect(statuses("/v1/environment")).toEqual([])
    expect(statuses("/v1/users")).toContain(429)
  })
})
