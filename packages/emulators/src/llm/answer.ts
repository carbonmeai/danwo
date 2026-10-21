import type { EmulatorContext } from "../define.ts"
/**
 * How every call is answered, whichever API it came through: a matching script, else a recording
 * of the real provider, else the unscripted fallback; then any fault the proxy asked for is acted
 * out, the tokens and cost are counted, and the call is logged for tests to read back.
 */
import { HttpError } from "../errors.ts"
import type { Context } from "../http.ts"
import { actOut, behaviourOf, type LlmBehaviour } from "./behaviours.ts"
import type { LlmReply, LlmRequest, LlmUsage } from "./entities.ts"
import { scriptedErrorResponse } from "./faults.ts"
import type { LlmApi } from "./parse.ts"
import { recordedReply, scrubKeys } from "./record.ts"
import { schemaProblems } from "./schema.ts"
import { scriptedReply, unscriptedReply } from "./scripts.ts"
import { llmStore } from "./store.ts"
import { costOf, usageOf } from "./usage.ts"

/** The header the proxy names an emulated fault in. */
const EMULATE_HEADER = "x-danwo-emulate"

/** A call's answer, ready for its provider's wire format. */
export interface Answered {
  readonly reply: LlmReply
  readonly usage: LlmUsage
  readonly cost: number | null
  readonly behaviour: LlmBehaviour | undefined
}

/** The reply a script, a recording or the fallback gives, and which one gave it. */
async function sourceReply(
  emulator: EmulatorContext,
  c: Context,
  api: LlmApi,
  request: LlmRequest,
): Promise<{ reply: LlmReply; script: string | null }> {
  const llm = llmStore(emulator.store)
  const scripted = scriptedReply(llm, request)

  if (scripted !== undefined) return scripted

  const body: unknown = await c.req.json()
  const recorded = await recordedReply(emulator.store, {
    api,
    request,
    path: new URL(c.req.url).pathname,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route already read this body as a JSON object
    body: body as Record<string, unknown>,
    headers: c.req.header(),
  })

  return recorded === undefined
    ? { reply: unscriptedReply(llm, request), script: null }
    : { reply: recorded, script: "recorded" }
}

/** Refuses a scripted structured answer that would not fit the schema the call asked for. */
function checkSchema(reply: LlmReply, request: LlmRequest): void {
  if (reply.json === undefined || request.schema === undefined) return

  const problems = schemaProblems(reply.json, request.schema)

  if (problems.length > 0)
    throw new HttpError(
      500,
      `danwo: the scripted JSON does not fit the schema the call asked for: ${problems.join("; ")}`,
    )
}

/** Answers `request`, logs the call, and returns what to send back. */
export async function answer(
  emulator: EmulatorContext,
  c: Context,
  api: LlmApi,
  request: LlmRequest,
): Promise<Answered> {
  const llm = llmStore(emulator.store)
  const { reply: source, script } = await sourceReply(emulator, c, api, request)

  checkSchema(source, request)

  const behaviour = behaviourOf(c.req.header(EMULATE_HEADER))
  const reply = actOut(source, behaviour, request)
  const usage = usageOf(request, reply)
  const cost = costOf(usage, llm.settings().prices[request.model])

  llm.calls.insert({
    provider: request.provider,
    api,
    model: request.model,
    system: scrubKeys(request.system),
    messages: request.messages.map((m) => ({ role: m.role, text: scrubKeys(m.text) })),
    tools: request.tools,
    stream: request.stream,
    reply,
    script,
    fault: behaviour ?? null,
    usage,
    cost,
  })

  if (reply.error !== undefined)
    throw new ScriptedFailure(scriptedErrorResponse(request.provider, reply.error))

  return { reply, usage, cost, behaviour }
}

/** A script's error, thrown so the call is answered with the provider's error response. */
export class ScriptedFailure extends Error {
  readonly response: Response

  constructor(response: Response) {
    super(`danwo: a script answered with status ${response.status}`)
    this.name = "ScriptedFailure"
    this.response = response
  }
}
