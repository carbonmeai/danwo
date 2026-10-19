/**
 * Google's Gemini API (`generativelanguage.googleapis.com`): its `generateContent` bodies read
 * into one request, and answers written back whole, as a stream of partial responses, or as a
 * blocked candidate when a content filter stops it.
 */
import { asRecord } from "../json.ts"
import type { LlmReply, LlmRequest, LlmUsage } from "./entities.ts"
import { request, splitMessages, textOf, toolNames } from "./requests.ts"
import { deltas, llmId, messageText, sse } from "./wire.ts"

/** One part of a candidate's content. */
type Part =
  | { readonly text: string }
  | {
      readonly functionCall: { readonly name: string; readonly args: unknown; readonly id?: string }
    }

/** A candidate, as `generateContent` answers it. */
interface Candidate {
  readonly content?: { readonly role: "model"; readonly parts: readonly Part[] }
  readonly finishReason?: string
  readonly index: number
  readonly safetyRatings?: readonly {
    readonly category: string
    readonly probability: string
    readonly blocked?: boolean
  }[]
}

/** A `generateContent` answer, or one chunk of `streamGenerateContent`. */
export interface GeminiResponse {
  readonly candidates: readonly Candidate[]
  readonly usageMetadata?: {
    readonly promptTokenCount: number
    readonly candidatesTokenCount: number
    readonly totalTokenCount: number
    readonly promptTokensDetails: readonly {
      readonly modality: string
      readonly tokenCount: number
    }[]
  }
  readonly modelVersion: string
  readonly responseId: string
}

const HARM_CATEGORIES = [
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
]

/** Gemini's roles: `model` is the assistant. */
function contents(list: unknown): unknown[] {
  return (Array.isArray(list) ? list : []).map((entry) => {
    const content = asRecord(entry)
    const role = content?.role === "model" ? "assistant" : (content?.role ?? "user")

    return { role, content: content?.parts }
  })
}

/**
 * Gemini's `responseSchema` as JSON Schema: its own subset names types in capitals (`OBJECT`,
 * `STRING`), which JSON Schema writes in lower case.
 */
function jsonSchemaOf(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(jsonSchemaOf)

  const record = asRecord(schema)

  if (record === undefined) return schema

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      key === "type" && typeof value === "string" ? value.toLowerCase() : jsonSchemaOf(value),
    ]),
  )
}

/** The schema a structured answer must follow, when the call asks for JSON. */
function schemaOf(config: Record<string, unknown> | undefined): unknown {
  if (config?.responseMimeType !== "application/json") return undefined

  return config.responseJsonSchema ?? jsonSchemaOf(config.responseSchema ?? {})
}

/** A `generateContent` or `streamGenerateContent` body; the model comes from the path. */
export function geminiRequest(
  body: Record<string, unknown>,
  model: string,
  stream: boolean,
): LlmRequest {
  const { messages } = splitMessages(contents(body.contents))
  const system = textOf(asRecord(body.systemInstruction)?.parts ?? body.systemInstruction)

  return request(
    "google",
    {
      model,
      system: [system],
      messages,
      tools: toolNames(body.tools),
      schema: schemaOf(asRecord(body.generationConfig)),
    },
    stream,
  )
}

/** Arguments as an object, or undefined when they are not valid JSON (a malformed call). */
function argsOf(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {}

  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** Whether a tool call's arguments cannot be read, which Gemini reports instead of the call. */
function malformed(reply: LlmReply): boolean {
  return (reply.toolCalls ?? []).some((call) => argsOf(call.arguments) === undefined)
}

function parts(reply: LlmReply): Part[] {
  const text = reply.refusal ?? messageText(reply)
  const calls = (reply.toolCalls ?? []).map((call): Part => ({
    functionCall: { name: call.name, args: argsOf(call.arguments) },
  }))

  return [...(text === "" ? [] : [{ text }]), ...calls]
}

function finishReason(reply: LlmReply): string {
  if (malformed(reply)) return "MALFORMED_FUNCTION_CALL"
  if (reply.stop === "content_filter") return "SAFETY"

  return reply.stop === "length" ? "MAX_TOKENS" : "STOP"
}

/** Safety ratings: all negligible, or the one that blocked the answer. */
function ratings(blocked: boolean): NonNullable<Candidate["safetyRatings"]> {
  return HARM_CATEGORIES.map((category, index) => ({
    category,
    probability: blocked && index === 1 ? "HIGH" : "NEGLIGIBLE",
    ...(blocked && index === 1 && { blocked: true }),
  }))
}

function usage(counts: LlmUsage): NonNullable<GeminiResponse["usageMetadata"]> {
  return {
    promptTokenCount: counts.input,
    candidatesTokenCount: counts.output,
    totalTokenCount: counts.input + counts.output,
    promptTokensDetails: [{ modality: "TEXT", tokenCount: counts.input }],
  }
}

/** The candidate a reply makes; a blocked or malformed one carries no content. */
function candidate(reply: LlmReply, withParts: readonly Part[]): Candidate {
  const reason = finishReason(reply)
  const empty = reason === "SAFETY" || reason === "MALFORMED_FUNCTION_CALL"

  return {
    ...(!empty && { content: { role: "model", parts: withParts } }),
    finishReason: reason,
    index: 0,
    safetyRatings: ratings(reason === "SAFETY"),
  }
}

/** A whole answer. */
export function geminiResponse(reply: LlmReply, counts: LlmUsage, model: string): GeminiResponse {
  return {
    candidates: [candidate(reply, parts(reply))],
    usageMetadata: usage(counts),
    modelVersion: model,
    responseId: llmId(""),
  }
}

/** One streamed chunk with some of the answer's parts, before the last chunk ends it. */
function chunk(whole: GeminiResponse, part: Part): GeminiResponse {
  return {
    candidates: [{ content: { role: "model", parts: [part] }, index: 0 }],
    modelVersion: whole.modelVersion,
    responseId: whole.responseId,
  }
}

/**
 * The chunks a streamed answer arrives in: its text a few words at a time, then a last chunk with
 * the tool calls, the finish reason and the usage.
 */
export function geminiChunks(reply: LlmReply, whole: GeminiResponse): GeminiResponse[] {
  const final = whole.candidates[0]
  const all = final?.content?.parts ?? []
  const text = all.flatMap((part) => ("text" in part ? deltas(part.text) : []))
  const calls = all.filter((part) => "functionCall" in part)
  const last: GeminiResponse = {
    ...whole,
    candidates: [candidate(reply, calls)],
  }

  return [...text.map((piece) => chunk(whole, { text: piece })), last]
}

/** A stream's chunks as server-sent events, as `?alt=sse` asks for. */
export function geminiStream(reply: LlmReply, whole: GeminiResponse): string[] {
  return geminiChunks(reply, whole).map((part) => sse(part))
}
