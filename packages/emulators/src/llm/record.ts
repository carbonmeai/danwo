/**
 * Recording: a call no script answers is sent once to the real provider, with the user's own key,
 * and its answer is saved as a script keyed by the exact request. Later runs replay the saved
 * scripts for nothing. Keys are only held in memory, never written to the store or the file, and
 * anything key-shaped is scrubbed from what is saved.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"

import { HttpError } from "../errors.ts"
import { asRecord } from "../json.ts"
import type { Store } from "../store.ts"
import type { LlmProvider, LlmReply, LlmRequest } from "./entities.ts"
import { ANTHROPIC_HOST, GATEWAY_HOST, OPENAI_HOST } from "./helpers.ts"
import { type LlmApi, replyFromAnswer } from "./parse.ts"
import { addScripts, fingerprintOf, type LlmScript } from "./scripts.ts"
import { llmStore } from "./store.ts"

/** How to record: where saved scripts live, and the real keys and hosts to ask. */
export interface LlmRecordOptions {
  /** A JSON file of scripts: loaded when the emulator is seeded, appended to as calls are recorded. */
  readonly file: string
  /** The user's own keys, by provider; a provider without a key is never called. */
  readonly keys?: Partial<Record<LlmProvider, string>>
  /** Where each provider is reached, e.g. a local stand-in in tests; the real host otherwise. */
  readonly upstreams?: Partial<Record<LlmProvider, string>>
  readonly fetch?: typeof fetch
}

const REAL_ORIGINS: Record<LlmProvider, string> = {
  openai: `https://${OPENAI_HOST}`,
  anthropic: `https://${ANTHROPIC_HOST}`,
  gateway: `https://${GATEWAY_HOST}`,
}

/** Each store's recording settings, held outside the store so its snapshots never carry keys. */
const recorders = new WeakMap<Store, LlmRecordOptions>()

/** Text with anything shaped like a provider key or bearer token replaced. */
export function scrubKeys(text: string): string {
  return text
    .replace(/\b(sk-(?:ant-[a-z0-9]+-|proj-|svcacct-)?)[A-Za-z0-9_-]{12,}/g, "$1[redacted]")
    .replace(/\b(vck_)[A-Za-z0-9_-]{8,}/g, "$1[redacted]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
}

function savedScripts(file: string): LlmScript[] {
  if (!existsSync(file)) return []

  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the file holds scripts this module wrote
  return Array.isArray(parsed) ? (parsed as LlmScript[]) : []
}

/** Takes up recording for `store`, and loads the scripts recorded before. */
export function startRecording(store: Store, options: LlmRecordOptions | undefined): void {
  if (options === undefined) {
    recorders.delete(store)

    return
  }

  recorders.set(store, options)
  addScripts(llmStore(store), savedScripts(options.file), true)
}

/** What a recording needs from the call it records. */
export interface RecordableCall {
  readonly api: LlmApi
  readonly request: LlmRequest
  readonly path: string
  readonly body: Record<string, unknown>
  readonly headers: Record<string, string>
}

/** The provider's own headers a call keeps, plus the user's key. */
function upstreamHeaders(call: RecordableCall, key: string): Record<string, string> {
  const kept = Object.fromEntries(
    Object.entries(call.headers).filter(([name]) => /^(anthropic-|ai-|openai-)/.test(name)),
  )
  const auth: Record<string, string> =
    call.request.provider === "anthropic"
      ? { "x-api-key": key }
      : { authorization: `Bearer ${key}` }

  return {
    ...kept,
    ...auth,
    "content-type": "application/json",
    "ai-language-model-streaming": "false",
  }
}

/** The body asked whole: recordings always read a whole answer, and replay it streamed if asked. */
function wholeBody(body: Record<string, unknown>): Record<string, unknown> {
  const { stream: _stream, stream_options: _options, ...rest } = body

  return rest
}

function save(store: Store, file: string, script: LlmScript): void {
  addScripts(llmStore(store), [script], true)

  const all = [...savedScripts(file), script]

  writeFileSync(file, `${scrubKeys(JSON.stringify(all, null, 2))}\n`)
}

/**
 * The real answer to `call`, recorded as a script, when the store is recording and has a key for
 * its provider; undefined otherwise.
 */
export async function recordedReply(
  store: Store,
  call: RecordableCall,
): Promise<LlmReply | undefined> {
  const options = recorders.get(store)
  const key = options?.keys?.[call.request.provider]

  if (options === undefined || key === undefined) return undefined

  const origin = options.upstreams?.[call.request.provider] ?? REAL_ORIGINS[call.request.provider]
  const response = await (options.fetch ?? fetch)(`${origin}${call.path}`, {
    method: "POST",
    headers: upstreamHeaders(call, key),
    body: JSON.stringify(wholeBody(call.body)),
  })

  if (!response.ok)
    throw new HttpError(
      response.status,
      `danwo record: ${call.request.provider} answered ${response.status}`,
    )

  const answer: unknown = await response.json()
  const reply = replyFromAnswer(call.api, asRecord(answer) ?? {})

  save(store, options.file, {
    name: `recorded ${call.request.model}`,
    match: { fingerprint: fingerprintOf(call.request) },
    reply,
  })

  return reply
}
