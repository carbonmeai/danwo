/**
 * Amazon Bedrock's runtime (`bedrock-runtime.<region>.amazonaws.com`): Converse and ConverseStream,
 * which every model answers in one shape, and InvokeModel with its stream, whose bodies are each
 * model family's own: Anthropic's Messages for Claude, Converse's shape for Nova, Titan's text and
 * embeddings, Cohere's embeddings, and a plain prompt for the rest.
 */
import { asRecord } from "../json.ts"
import { anthropicEvents, anthropicMessage } from "./anthropic.ts"
import type { LlmReply, LlmRequest, LlmUsage } from "./entities.ts"
import { eventFrame } from "./eventstream.ts"
import { messagesRequest, request, splitMessages, str, textOf, toolNames } from "./requests.ts"
import { argumentsText } from "./usage.ts"
import { deltas, llmId, messageText } from "./wire.ts"

/** The model families `InvokeModel` reads and writes differently. */
export type BedrockFamily =
  | "anthropic"
  | "nova"
  | "titan-text"
  | "titan-embed"
  | "cohere-embed"
  | "prompt"

/** The family a model id (or inference profile, such as `us.anthropic.claude-…`) belongs to. */
export function familyOf(model: string): BedrockFamily {
  if (model.includes("anthropic.")) return "anthropic"
  if (model.includes("amazon.nova")) return "nova"
  if (model.includes("amazon.titan-embed")) return "titan-embed"
  if (model.includes("amazon.titan")) return "titan-text"

  return model.includes("cohere.embed") ? "cohere-embed" : "prompt"
}

/** The schema Claude's native structured output asks for, in `additionalModelRequestFields`. */
function nativeSchema(body: Record<string, unknown>): unknown {
  const config = asRecord(asRecord(body.additionalModelRequestFields)?.output_config)

  return asRecord(config?.format)?.schema
}

/** The input schema of the `json` tool the AI SDK adds for structured output, when it does. */
function jsonToolSchema(body: Record<string, unknown>): unknown {
  const tools = asRecord(body.toolConfig)?.tools
  const json = (Array.isArray(tools) ? tools : [])
    .map((tool) => asRecord(asRecord(tool)?.toolSpec))
    .find((spec) => spec?.name === "json")

  return json === undefined ? undefined : (asRecord(json.inputSchema)?.json ?? {})
}

/** The schema of a structured answer: native output config, or the `json` tool the AI SDK adds. */
function schemaOf(body: Record<string, unknown>): unknown {
  return nativeSchema(body) ?? jsonToolSchema(body)
}

/** A Converse or ConverseStream body (and Nova's InvokeModel body, which has the same shape). */
export function converseRequest(
  body: Record<string, unknown>,
  model: string,
  stream: boolean,
): LlmRequest {
  const { messages } = splitMessages(body.messages)

  return request(
    "bedrock",
    {
      model,
      system: [textOf(body.system)],
      messages,
      tools: toolNames(asRecord(body.toolConfig)?.tools),
      schema: schemaOf(body),
    },
    stream,
  )
}

/** An InvokeModel body, read the way its model family writes it. */
export function invokeRequest(
  body: Record<string, unknown>,
  model: string,
  stream: boolean,
): LlmRequest {
  const family = familyOf(model)

  if (family === "anthropic") return messagesRequest(body, "bedrock", model, stream)
  if (family === "nova") return converseRequest(body, model, stream)

  const prompt = str(body.inputText) || str(body.prompt)

  return request(
    "bedrock",
    { model, system: [], messages: [{ role: "user", text: prompt }], tools: [] },
    stream,
  )
}

/** Whether a call asked for structured output through the `json` tool, so the answer is a call to it. */
function answersWithJsonTool(reply: LlmReply, asked: LlmRequest): boolean {
  return reply.json !== undefined && asked.tools.includes("json")
}

/**
 * A tool call's input: its arguments as an object. Arguments that are not valid JSON (a malformed
 * call) go out as the raw string, as a broken model output would leave them.
 */
function inputOf(value: unknown): unknown {
  if (typeof value !== "string") return value ?? {}

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** One Converse content block. */
type Block =
  | { readonly text: string }
  | {
      readonly toolUse: {
        readonly toolUseId: string
        readonly name: string
        readonly input: unknown
      }
    }

function blocks(reply: LlmReply, asked: LlmRequest): Block[] {
  if (answersWithJsonTool(reply, asked))
    return [{ toolUse: { toolUseId: llmId("tooluse_"), name: "json", input: reply.json } }]

  const text = reply.refusal ?? messageText(reply)
  const calls = (reply.toolCalls ?? []).map((call): Block => ({
    toolUse: { toolUseId: llmId("tooluse_"), name: call.name, input: inputOf(call.arguments) },
  }))

  return [...(text === "" ? [] : [{ text }]), ...calls]
}

function stopReason(reply: LlmReply, content: readonly Block[]): string {
  if (reply.stop === "content_filter") return "content_filtered"
  if (reply.stop === "length") return "max_tokens"

  return content.some((block) => "toolUse" in block) ? "tool_use" : "end_turn"
}

function usage(counts: LlmUsage) {
  return {
    inputTokens: counts.input,
    outputTokens: counts.output,
    totalTokens: counts.input + counts.output,
  }
}

/** A whole Converse answer. */
export function converseResponse(reply: LlmReply, counts: LlmUsage, asked: LlmRequest) {
  const content = blocks(reply, asked)

  return {
    output: { message: { role: "assistant", content } },
    stopReason: stopReason(reply, content),
    usage: usage(counts),
    metrics: { latencyMs: 120 },
  }
}

type ConverseResponse = ReturnType<typeof converseResponse>

/** A block's events: a tool call's start, its text or input in pieces, then its stop. */
function blockEvents(block: Block, index: number): [string, unknown][] {
  if ("text" in block)
    return [
      ...deltas(block.text).map((text): [string, unknown] => [
        "contentBlockDelta",
        { contentBlockIndex: index, delta: { text } },
      ]),
      ["contentBlockStop", { contentBlockIndex: index }],
    ]

  const { input, ...start } = block.toolUse

  return [
    ["contentBlockStart", { contentBlockIndex: index, start: { toolUse: start } }],
    ...deltas(argumentsText(input)).map((piece): [string, unknown] => [
      "contentBlockDelta",
      { contentBlockIndex: index, delta: { toolUse: { input: piece } } },
    ]),
    ["contentBlockStop", { contentBlockIndex: index }],
  ]
}

/** A Converse answer as its stream's events, each named, in order. */
function converseEvents(whole: ConverseResponse): [string, unknown][] {
  return [
    ["messageStart", { role: "assistant" }],
    ...whole.output.message.content.flatMap(blockEvents),
    ["messageStop", { stopReason: whole.stopReason }],
    ["metadata", { usage: whole.usage, metrics: whole.metrics }],
  ]
}

/** ConverseStream's frames: each event under its own name, padded as Bedrock pads them. */
export function converseFrames(whole: ConverseResponse): Buffer[] {
  return converseEvents(whole).map(([type, payload]) =>
    eventFrame(type, { ...asRecord(payload), p: "abcdefghij" }),
  )
}

/** The invocation metrics Bedrock adds to the last chunk of an InvokeModel stream. */
function invocationMetrics(counts: LlmUsage) {
  return {
    "amazon-bedrock-invocationMetrics": {
      inputTokenCount: counts.input,
      outputTokenCount: counts.output,
      invocationLatency: 120,
      firstByteLatency: 40,
    },
  }
}

/** A model's own stream chunk, wrapped as InvokeModelWithResponseStream sends it. */
function chunkFrame(chunk: unknown): Buffer {
  return eventFrame("chunk", { bytes: Buffer.from(JSON.stringify(chunk)).toString("base64") })
}

/** Titan's whole text answer. */
function titanText(reply: LlmReply, counts: LlmUsage) {
  return {
    inputTextTokenCount: counts.input,
    results: [
      {
        tokenCount: counts.output,
        outputText: messageText(reply),
        completionReason: titanReason(reply),
      },
    ],
  }
}

/** The plain-prompt families' whole answer (Llama, Mistral and the like). */
function promptText(reply: LlmReply, counts: LlmUsage) {
  return {
    generation: messageText(reply),
    prompt_token_count: counts.input,
    generation_token_count: counts.output,
    stop_reason: promptReason(reply),
  }
}

/** A whole InvokeModel answer in its family's shape. */
export function invokeResponse(reply: LlmReply, counts: LlmUsage, asked: LlmRequest): unknown {
  const family = familyOf(asked.model)

  if (family === "anthropic") return anthropicMessage(reply, counts, asked.model)

  if (family === "nova") {
    const { metrics: _metrics, ...nova } = converseResponse(reply, counts, asked)

    return nova
  }

  return family === "titan-text" ? titanText(reply, counts) : promptText(reply, counts)
}

/** The chunks a family's stream sends, before each is wrapped. */
function invokeChunks(reply: LlmReply, counts: LlmUsage, asked: LlmRequest): unknown[] {
  const family = familyOf(asked.model)

  if (family === "anthropic")
    return anthropicEvents(reply, anthropicMessage(reply, counts, asked.model))
  if (family === "nova")
    return converseEvents(converseResponse(reply, counts, asked)).map(([type, payload]) => ({
      [type]: payload,
    }))

  const pieces = deltas(messageText(reply))
  const texts = pieces.length === 0 ? [""] : pieces
  const chunk = family === "titan-text" ? titanChunk : promptChunk

  return texts.map((piece, index) =>
    chunk(piece, counts, { first: index === 0, done: index === texts.length - 1, reply }),
  )
}

/** Where a streamed text chunk falls: the first carries the prompt's tokens, the last the rest. */
interface ChunkPlace {
  readonly first: boolean
  readonly done: boolean
  readonly reply: LlmReply
}

function titanReason(reply: LlmReply): string {
  return reply.stop === "length" ? "LENGTH" : "FINISH"
}

function promptReason(reply: LlmReply): string {
  return reply.stop === "length" ? "length" : "stop"
}

/** One chunk of Titan's text stream. */
function titanChunk(piece: string, counts: LlmUsage, place: ChunkPlace) {
  return {
    outputText: piece,
    index: 0,
    totalOutputTextTokenCount: place.done ? counts.output : null,
    completionReason: place.done ? titanReason(place.reply) : null,
    inputTextTokenCount: place.first ? counts.input : null,
  }
}

/** One chunk of a plain-prompt model's stream. */
function promptChunk(piece: string, counts: LlmUsage, place: ChunkPlace) {
  return {
    generation: piece,
    prompt_token_count: place.first ? counts.input : null,
    generation_token_count: place.done ? counts.output : null,
    stop_reason: place.done ? promptReason(place.reply) : null,
  }
}

/** InvokeModelWithResponseStream's frames, with the invocation metrics on the last chunk. */
export function invokeFrames(reply: LlmReply, counts: LlmUsage, asked: LlmRequest): Buffer[] {
  const chunks = invokeChunks(reply, counts, asked)
  const last = chunks.length - 1

  return chunks.map((chunk, index) =>
    chunkFrame(index === last ? { ...asRecord(chunk), ...invocationMetrics(counts) } : chunk),
  )
}
