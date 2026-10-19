/**
 * Resend's fidelity suite: sending and reading back an email, batch sends, idempotent sends,
 * validation and key errors, and the domains list. Resend has no separate test mode, so live runs
 * only ever send to Resend's own test inbox, `delivered@resend.dev`, from its shared sender.
 */
import { resend } from "@danwo/emulators"

import { type FidelityProvider, requiredCredentials } from "../provider.ts"
import type { Answer, Scenario, ScenarioContext, StepDoc, StepOptions } from "../scenario.ts"
import { asJsonObject, type Json } from "../shape.ts"
import { bearerRequest, emulatorTarget, liveTarget } from "../target.ts"

const API = "https://api.resend.com"
const KEY = "DANWO_FIDELITY_RESEND_KEY"
const SENDER = "Danwo Fidelity <onboarding@resend.dev>"
const INBOX = "delivered@resend.dev"

/** Resend's error body, as its documentation describes it. */
const ERROR_SCHEMA = {
  type: "object",
  required: ["statusCode", "name", "message"],
  properties: {
    statusCode: { type: "number" },
    name: { type: "string" },
    message: { type: "string" },
  },
}

function errorDoc(status: number, name: string): StepDoc {
  return { schema: ERROR_SCHEMA, status, literals: { name, statusCode: status } }
}

const ERROR_LITERALS = ["name", "statusCode"]

function call(
  context: ScenarioContext,
  method: string,
  path: string,
  body?: unknown,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return bearerRequest(context.target, method, `${API}${path}`, body, headers)
}

/**
 * A read step. A sending-only key gets 401 `restricted_api_key` on every read, which says nothing
 * about the emulator, so the scenario is skipped with a note on the key it needs instead.
 */
async function read(
  context: ScenarioContext,
  name: string,
  request: Request,
  options: StepOptions,
): Promise<Answer> {
  const answer = await context.step(name, request, options)

  if (answer.status === 401 && asJsonObject(answer.body)?.["name"] === "restricted_api_key")
    context.skip("the key can only send; use a full-access Resend key to check reads")

  return answer
}

function email(context: ScenarioContext, subject: string): Record<string, unknown> {
  return {
    from: SENDER,
    to: [INBOX],
    subject: `${subject} ${context.unique}`,
    html: "<p>Sent by a danwo fidelity check.</p>",
  }
}

function idOf(body: Json): string {
  const id = asJsonObject(body)?.["id"]

  if (typeof id !== "string") throw new Error("expected the answer to carry an id")

  return id
}

const sendAndRead: Scenario = {
  name: "emails: send and read back",
  async run(context) {
    const sent = await context.step(
      "send email",
      call(context, "POST", "/emails", email(context, "Fidelity")),
      {
        doc: { operation: "post /emails", status: 200 },
      },
    )

    await read(context, "retrieve email", call(context, "GET", `/emails/${idOf(sent.body)}`), {
      doc: { operation: "get /emails/{email_id}", status: 200, literals: { object: "email" } },
    })
  },
}

const batch: Scenario = {
  name: "emails: batch send",
  documentedFacts: [{ name: "ids returned", value: 2 }],
  async run(context) {
    const sent = await context.step(
      "send a batch of two",
      call(context, "POST", "/emails/batch", [
        email(context, "Batch one"),
        email(context, "Batch two"),
      ]),
      { doc: { operation: "post /emails/batch", status: 200 } },
    )
    const data = asJsonObject(sent.body)?.["data"]

    context.fact("ids returned", Array.isArray(data) ? data.length : 0)
  },
}

const idempotency: Scenario = {
  name: "emails: idempotent send",
  documentedFacts: [{ name: "a retry returns the same email", value: true }],
  async run(context) {
    const key = { "idempotency-key": `danwo-fidelity-${context.unique}` }
    const body = email(context, "Idempotent")
    const first = await context.step(
      "send with an idempotency key",
      call(context, "POST", "/emails", body, key),
      {
        doc: { operation: "post /emails", status: 200 },
      },
    )
    const retry = await context.step(
      "retry the same send",
      call(context, "POST", "/emails", body, key),
      {
        doc: { operation: "post /emails", status: 200 },
      },
    )

    context.fact("a retry returns the same email", idOf(first.body) === idOf(retry.body))
  },
}

const errors: Scenario = {
  name: "errors: missing field, missing key",
  async run(context) {
    await context.step(
      "send without a recipient",
      call(context, "POST", "/emails", { from: SENDER, subject: "No recipient", html: "<p>x</p>" }),
      {
        literals: ERROR_LITERALS,
        doc: errorDoc(422, "missing_required_field"),
      },
    )
    await context.step(
      "call without a key",
      new Request(`${API}/emails/${"0".repeat(8)}-0000-0000-0000-000000000000`),
      { literals: ERROR_LITERALS, doc: errorDoc(401, "missing_api_key") },
    )
  },
}

const domains: Scenario = {
  name: "domains: list",
  async run(context) {
    await read(context, "list domains", call(context, "GET", "/domains"), {
      doc: { operation: "get /domains", status: 200 },
    })
  },
}

export const resendFidelity: FidelityProvider = {
  name: "resend",
  openapi: "https://raw.githubusercontent.com/resend/resend-openapi/main/resend.yaml",
  openapiLooseNulls: true,
  credentials: [
    {
      name: KEY,
      description:
        "a Resend API key; runs send only to delivered@resend.dev from onboarding@resend.dev",
    },
  ],
  scenarios: [sendAndRead, batch, idempotency, errors, domains],
  emulator: () => emulatorTarget(resend, { key: "re_danwo_fidelity" }),
  live(env) {
    const key = requiredCredentials(this, env)?.[KEY]

    return key === undefined ? undefined : liveTarget({ key })
  },
}
