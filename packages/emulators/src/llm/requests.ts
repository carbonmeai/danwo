/**
 * Reads each provider's request body into one shape: the model, the system prompt, the messages as
 * role and text, the tools on offer, any schema a structured answer must follow, and streaming.
 */
import { asRecord, isRecord } from "../json.ts"
import type { LlmMessage, LlmProvider, LlmRequest } from "./entities.ts"

/** The text inside a message's content, whichever way a provider lays it out. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map(partText).filter(Boolean).join("\n")

  return isRecord(content) ? partText(content) : ""
}

/**
 * The text a tool's result hands back, in Bedrock's (`toolResult`) or Gemini's
 * (`functionResponse`) shape; undefined for any other part.
 */
function toolResultText(record: Record<string, unknown>): string | undefined {
  const bedrock = asRecord(record.toolResult)

  if (bedrock !== undefined) return textOf(bedrock.content)

  const gemini = asRecord(record.functionResponse)

  return gemini === undefined ? undefined : JSON.stringify(gemini.response ?? {})
}

/** A part's own text, as a string, a `text` field or a `json` value. */
function ownText(record: Record<string, unknown>): string | undefined {
  if (typeof record.text === "string") return record.text
  if (record.json !== undefined) return JSON.stringify(record.json)

  return typeof record.output === "string" ? record.output : undefined
}

/** A content part's text: its own text, its nested content, or a tool result's output. */
function partText(part: unknown): string {
  if (typeof part === "string") return part

  const record = asRecord(part)

  if (record === undefined) return ""
  if (record.content !== undefined && ownText(record) === undefined) return textOf(record.content)

  const text = ownText(record) ?? toolResultText(record)

  if (text !== undefined) return text

  const output = asRecord(record.output)

  return output === undefined ? "" : textOf(output.value)
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** Whether a part hands back a tool's result, in Anthropic's, Bedrock's or Gemini's shape. */
function isToolResult(part: unknown): boolean {
  const record = asRecord(part)

  return (
    record?.type === "tool_result" ||
    record?.toolResult !== undefined ||
    record?.functionResponse !== undefined
  )
}

/** Whether a message only hands back tool results, as the user turns after a tool call do. */
function onlyToolResults(content: unknown): boolean {
  return Array.isArray(content) && content.length > 0 && content.every(isToolResult)
}

/** The messages of a list, with system and developer messages split out. */
export function splitMessages(list: unknown): { system: string[]; messages: LlmMessage[] } {
  const system: string[] = []
  const messages: LlmMessage[] = []

  for (const entry of Array.isArray(list) ? list : []) {
    const message = asRecord(entry)

    if (message === undefined) continue

    const role = onlyToolResults(message.content) ? "tool" : str(message.role) || str(message.type)
    const text = textOf(message.content ?? message.output)

    if (role === "system" || role === "developer") system.push(text)
    else messages.push({ role, text })
  }

  return { system, messages }
}

/** A tool definition's name: flat, or wrapped in `function` (OpenAI) or `toolSpec` (Bedrock). */
function toolName(entry: unknown): string {
  const tool = asRecord(entry)

  return (
    str(tool?.name) || str(asRecord(tool?.function)?.name) || str(asRecord(tool?.toolSpec)?.name)
  )
}

/**
 * Tool names from a list of tool definitions. Gemini groups its functions under
 * `functionDeclarations`, each read as a tool of its own.
 */
export function toolNames(list: unknown): string[] {
  return (Array.isArray(list) ? list : []).flatMap((entry): string[] => {
    const declarations = asRecord(entry)?.functionDeclarations

    if (Array.isArray(declarations)) return toolNames(declarations)

    const name = toolName(entry)

    return name === "" ? [] : [name]
  })
}

/** A request's parts, before the provider and streaming are known. */
export interface Parsed {
  readonly model: string
  readonly system: readonly string[]
  readonly messages: readonly LlmMessage[]
  readonly tools: readonly string[]
  readonly schema?: unknown
}

export function request(provider: LlmProvider, parsed: Parsed, stream: boolean): LlmRequest {
  return {
    provider,
    model: parsed.model,
    system: parsed.system.filter(Boolean).join("\n"),
    messages: parsed.messages,
    tools: parsed.tools,
    ...(parsed.schema !== undefined && { schema: parsed.schema }),
    stream,
  }
}

/** The schema of an OpenAI `response_format` or Responses `text.format`, when it asks for JSON. */
export function openaiSchema(format: unknown): unknown {
  const record = asRecord(format)

  if (record?.type === "json_object") return {}
  if (record?.type !== "json_schema") return undefined

  return asRecord(record.json_schema)?.schema ?? record.schema ?? {}
}

/**
 * A Chat Completions body. Perplexity's Sonar API takes the same body, so `provider` names which
 * API it came through.
 */
export function chatRequest(
  body: Record<string, unknown>,
  provider: LlmProvider = "openai",
): LlmRequest {
  const { system, messages } = splitMessages(body.messages)

  return request(
    provider,
    {
      model: str(body.model),
      system,
      messages,
      tools: toolNames(body.tools),
      schema: openaiSchema(body.response_format),
    },
    body.stream === true,
  )
}

/** A Responses API body: `input` is a string or a list of items. */
export function responsesRequest(body: Record<string, unknown>): LlmRequest {
  const input =
    typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input
  const { system, messages } = splitMessages(input)

  return request(
    "openai",
    {
      model: str(body.model),
      system: [str(body.instructions), ...system],
      messages,
      tools: toolNames(body.tools),
      schema: openaiSchema(asRecord(body.text)?.format),
    },
    body.stream === true,
  )
}

/**
 * An Anthropic Messages body; `system` is a string or a list of text blocks. Bedrock carries the
 * same body for Claude models, so `provider` names which API it came through, and Bedrock's model
 * comes from the path.
 */
export function messagesRequest(
  body: Record<string, unknown>,
  provider: LlmProvider = "anthropic",
  model: string = str(body.model),
  stream: boolean = body.stream === true,
): LlmRequest {
  const { messages } = splitMessages(body.messages)

  return request(
    provider,
    { model, system: [textOf(body.system)], messages, tools: toolNames(body.tools) },
    stream,
  )
}

/** An AI Gateway language model call: the model and streaming arrive as headers. */
export function gatewayRequest(
  body: Record<string, unknown>,
  model: string,
  stream: boolean,
): LlmRequest {
  const { system, messages } = splitMessages(body.prompt)
  const format = asRecord(body.responseFormat)

  return request(
    "gateway",
    {
      model,
      system,
      messages,
      tools: toolNames(body.tools),
      schema: format?.type === "json" ? (format.schema ?? {}) : undefined,
    },
    stream,
  )
}

/** The last thing the user said. */
export function lastUser(asked: LlmRequest): string {
  return asked.messages.findLast((message) => message.role === "user")?.text ?? ""
}
