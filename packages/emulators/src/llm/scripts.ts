/**
 * Scripted answers: each script names when it answers (model, last user message, system prompt,
 * an offered tool, or an exact recorded request) and what it answers, in order when it holds
 * several replies. The first script that matches a call answers it.
 */
import { createHash } from "node:crypto"

import { HttpError } from "../errors.ts"
import type { LlmProvider, LlmReply, LlmRequest, StoredMatch, StoredPattern } from "./entities.ts"
import { lastUser } from "./requests.ts"
import type { LlmStore } from "./store.ts"

/** A pattern as a seed or test gives it: a regular expression, or a string that is one. */
export type PatternInput = RegExp | string

/** When a script answers, as a seed or test gives it. */
export interface LlmMatchInput {
  readonly provider?: LlmProvider
  readonly model?: PatternInput
  readonly user?: PatternInput
  readonly system?: PatternInput
  readonly tool?: string
  /**
   * True for the turn after a tool call (the last message is a tool's result), false for others; a
   * pattern for the turn after a tool call whose result's text matches it, such as a tool's error.
   */
  readonly toolResult?: boolean | PatternInput
  readonly fingerprint?: string
}

/** A scripted answer: one reply, or several given out in turn (the last one repeating). */
export interface LlmScript {
  readonly name?: string
  readonly match?: LlmMatchInput
  readonly reply: LlmReply | readonly LlmReply[]
}

function stored(pattern: PatternInput | undefined): StoredPattern | undefined {
  if (pattern === undefined) return undefined

  return typeof pattern === "string"
    ? { source: pattern, flags: "i" }
    : { source: pattern.source, flags: pattern.flags }
}

function storedMatch(match: LlmMatchInput = {}): StoredMatch {
  const model = stored(match.model)
  const user = stored(match.user)
  const system = stored(match.system)
  const toolResult =
    typeof match.toolResult === "boolean" ? match.toolResult : stored(match.toolResult)

  return {
    ...(match.provider !== undefined && { provider: match.provider }),
    ...(model && { model }),
    ...(user && { user }),
    ...(system && { system }),
    ...(match.tool !== undefined && { tool: match.tool }),
    ...(toolResult !== undefined && { toolResult }),
    ...(match.fingerprint !== undefined && { fingerprint: match.fingerprint }),
  }
}

/** Adds scripts after the ones already there; `recorded` marks those a recording made. */
export function addScripts(llm: LlmStore, scripts: readonly LlmScript[], recorded = false): void {
  for (const script of scripts) {
    const replies = Array.isArray(script.reply) ? script.reply : [script.reply]

    llm.scripts.insert({
      name: script.name ?? `script ${llm.scripts.count() + 1}`,
      match: storedMatch(script.match),
      replies,
      served: 0,
      recorded,
    })
  }
}

/** A short digest of everything a call asked, so a recording answers exactly that call again. */
export function fingerprintOf(request: LlmRequest): string {
  const { stream: _stream, ...asked } = request

  return createHash("sha256").update(JSON.stringify(asked)).digest("hex").slice(0, 24)
}

function tests(pattern: StoredPattern | undefined, text: string): boolean {
  return pattern === undefined || new RegExp(pattern.source, pattern.flags).test(text)
}

/** Whether the call's last message hands back a tool's result. */
function afterToolCall(request: LlmRequest): boolean {
  const role = request.messages.at(-1)?.role

  return role === "tool" || role === "function_call_output"
}

/**
 * Whether the call is the turn after a tool call when `toolResult` asks for one (and its result's
 * text matches, for a pattern), or is not when it asks for that.
 */
function toolResultFits(toolResult: StoredMatch["toolResult"], request: LlmRequest): boolean {
  if (toolResult === undefined) return true
  if (typeof toolResult === "boolean") return toolResult === afterToolCall(request)

  return afterToolCall(request) && tests(toolResult, request.messages.at(-1)?.text ?? "")
}

/** Each condition a script can set, and whether a call meets it; an unset one always holds. */
const CONDITIONS: ReadonlyArray<(match: StoredMatch, request: LlmRequest) => boolean> = [
  (match, request) => match.provider === undefined || match.provider === request.provider,
  (match, request) => match.tool === undefined || request.tools.includes(match.tool),
  (match, request) => toolResultFits(match.toolResult, request),
  (match, request) =>
    match.fingerprint === undefined || match.fingerprint === fingerprintOf(request),
  (match, request) => tests(match.model, request.model),
  (match, request) => tests(match.user, lastUser(request)),
  (match, request) => tests(match.system, request.system),
]

function matches(match: StoredMatch, request: LlmRequest): boolean {
  return CONDITIONS.every((condition) => condition(match, request))
}

/** The script that answers `request`, if any, and its reply; the script moves to its next reply. */
export function scriptedReply(
  llm: LlmStore,
  request: LlmRequest,
): { readonly reply: LlmReply; readonly script: string } | undefined {
  const script = llm.scripts
    .all()
    .toSorted((a, b) => a.id - b.id)
    .find((row) => matches(row.match, request))

  if (script === undefined) return undefined

  const reply = script.replies[Math.min(script.served, script.replies.length - 1)] ?? {}

  llm.scripts.update(script.id, { served: script.served + 1 })

  return { reply, script: script.name }
}

/** What a call nothing scripted gets: its own words back, clearly marked, or an error. */
export function unscriptedReply(llm: LlmStore, request: LlmRequest): LlmReply {
  if (llm.settings().unscripted === "echo")
    return { text: `[danwo: unscripted] ${lastUser(request)}` }

  throw new HttpError(
    500,
    `danwo: no script answers this ${request.provider} call (model "${request.model}", last user message "${lastUser(request).slice(0, 120)}")`,
  )
}
