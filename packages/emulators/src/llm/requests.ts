/**
 * Reads each provider's request body into one shape: the model, the system prompt, the messages as
 * role and text, the tools on offer, any schema a structured answer must follow, and streaming.
 */
import { asRecord, isRecord } from "../json.ts"
import type { LlmMessage, LlmProvider, LlmRequest } from "./entities.ts"

/** The text inside a message's content, whichever way a provider lays it out. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map(partText).filter(Boolean).join("\n")

  return isRecord(content) ? partText(content) : ""
}

/** A content part's text: its own text, its nested content, or a tool result's output. */
function partText(part: unknown): string {
  if (typeof part === "string") return part

  const record = asRecord(part)

  if (record === undefined) return ""
  if (typeof record.text === "string") return record.text
  if (record.content !== undefined) return textOf(record.content)
  if (typeof record.output === "string") return record.output

  const output = asRecord(record.output)

  return output === undefined ? "" : textOf(output.value)
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** Whether a message only hands back tool results, as Anthropic's user turns after a tool call do. */
function onlyToolResults(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.every((part) => asRecord(part)?.type === "tool_result")
  )
}

/** The messages of a list, with system and developer messages split out. */
function splitMessages(list: unknown): { system: string[]; messages: LlmMessage[] } {
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

/** Tool names from a list of tool definitions, flat or wrapped in `function`. */
function toolNames(list: unknown): string[] {
  return (Array.isArray(list) ? list : []).flatMap((entry) => {
    const tool = asRecord(entry)
    const name = str(tool?.name) || str(asRecord(tool?.function)?.name)

    return name === "" ? [] : [name]
  })
}

/** A request's parts, before the provider and streaming are known. */
interface Parsed {
  readonly model: string
  readonly system: readonly string[]
  readonly messages: readonly LlmMessage[]
  readonly tools: readonly string[]
  readonly schema?: unknown
}

function request(provider: LlmProvider, parsed: Parsed, stream: boolean): LlmRequest {
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
function openaiSchema(format: unknown): unknown {
  const record = asRecord(format)

  if (record?.type === "json_object") return {}
  if (record?.type !== "json_schema") return undefined

  return asRecord(record.json_schema)?.schema ?? record.schema ?? {}
}

/** A Chat Completions body. */
export function chatRequest(body: Record<string, unknown>): LlmRequest {
  const { system, messages } = splitMessages(body.messages)

  return request(
    "openai",
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

/** An Anthropic Messages body; `system` is a string or a list of text blocks. */
export function messagesRequest(body: Record<string, unknown>): LlmRequest {
  const { messages } = splitMessages(body.messages)

  return request(
    "anthropic",
    {
      model: str(body.model),
      system: [textOf(body.system)],
      messages,
      tools: toolNames(body.tools),
    },
    body.stream === true,
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
