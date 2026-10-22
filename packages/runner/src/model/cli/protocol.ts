/**
 * How a model call becomes one run of a coding CLI and back. A CLI takes text (and image files),
 * not the AI SDK's messages and tool definitions, so the whole conversation is written out as one
 * prompt, the tools with their input schemas included, and the answer is asked for as one JSON
 * object: the tool calls to make, each input as a JSON-encoded string, and any text. The CLI's own
 * structured-output mode holds the answer to that shape; it is checked again here with zod and
 * turned back into tool calls.
 */
import type {
  JSONSchema7,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4FunctionTool,
  LanguageModelV4Prompt,
  LanguageModelV4ToolResultOutput,
  SharedV4FileData,
  SharedV4Warning,
} from "@ai-sdk/provider"
import { z } from "zod"

/** An image the prompt refers to by its label, written to a file for the CLI. */
export interface CliImage {
  readonly label: string
  readonly mediaType: string
  readonly bytes: Uint8Array
}

/** A model call as a CLI takes it. */
export interface CliPrompt {
  /** The call's system messages, for the CLI's own system-prompt option. */
  readonly system: string
  /** The conversation and what to answer, as one text. */
  readonly text: string
  readonly images: readonly CliImage[]
  /** The JSON schema the answer must match, when the call has tools to call; else plain text. */
  readonly schema?: JSONSchema7
  readonly warnings: readonly SharedV4Warning[]
}

/** The call options a CLI cannot honour, each named in a warning. */
const UNSUPPORTED = [
  "temperature",
  "topP",
  "topK",
  "seed",
  "maxOutputTokens",
  "stopSequences",
  "presencePenalty",
  "frequencyPenalty",
] as const

/** An image's bytes, when the file part holds them. */
function bytesOf(data: SharedV4FileData): Uint8Array | undefined {
  if (data.type === "data")
    return typeof data.data === "string" ? Buffer.from(data.data, "base64") : data.data

  if (data.type === "url" && data.url.protocol === "data:") {
    const comma = data.url.href.indexOf(",")

    return comma < 0 ? undefined : Buffer.from(data.url.href.slice(comma + 1), "base64")
  }

  return undefined
}

/** Walks the prompt's images, newest last, keeping the last `max` of them. */
class Images {
  readonly kept: CliImage[] = []
  private seen = 0
  private readonly total: number
  private readonly max: number

  constructor(total: number, max: number) {
    this.total = total
    this.max = max
  }

  /** The placeholder for a file part in the text, keeping its bytes when it is one of the last. */
  place(data: SharedV4FileData, mediaType: string): string {
    if (data.type === "text") return data.text
    if (!mediaType.startsWith("image/")) return `[a ${mediaType} file, not shown]`

    this.seen++

    const bytes = bytesOf(data)

    if (bytes === undefined || this.seen <= this.total - this.max)
      return "[an earlier image, not shown]"

    const label = `image ${this.kept.length + 1}`

    this.kept.push({ label, mediaType, bytes })

    return `[${label}, attached]`
  }
}

/** A part of a message other than the system's. */
type Part = Exclude<LanguageModelV4Prompt[number], { role: "system" }>["content"][number]

/** How many images a message part holds: a file, or the files in a tool's result. */
function imagesIn(part: Part): number {
  if (part.type === "file") return part.mediaType.startsWith("image/") ? 1 : 0
  if (part.type !== "tool-result" || part.output.type !== "content") return 0

  return part.output.value.filter(
    (item) => item.type === "file" && item.mediaType.startsWith("image/"),
  ).length
}

/** How many image parts the prompt holds. */
function imageCount(prompt: LanguageModelV4Prompt): number {
  return prompt
    .flatMap((message): Part[] => (message.role === "system" ? [] : [...message.content]))
    .reduce((sum, part) => sum + imagesIn(part), 0)
}

/** A tool result's output as text. */
function outputText(output: LanguageModelV4ToolResultOutput, images: Images): string {
  switch (output.type) {
    case "text":
      return output.value
    case "error-text":
      return `error: ${output.value}`
    case "json":
      return JSON.stringify(output.value)
    case "error-json":
      return `error: ${JSON.stringify(output.value)}`
    case "execution-denied":
      return `not run${output.reason === undefined ? "" : `: ${output.reason}`}`
    case "content":
      return output.value
        .map((item) =>
          item.type === "text"
            ? item.text
            : item.type === "file"
              ? images.place(item.data, item.mediaType)
              : "",
        )
        .join("\n")
    default:
      return ""
  }
}

/** The conversation, message by message, as headed sections. */
function transcript(prompt: LanguageModelV4Prompt, images: Images): string[] {
  const sections: string[] = []

  for (const message of prompt) {
    if (message.role === "system") continue

    if (message.role === "user") {
      const text = message.content
        .map((part) => (part.type === "text" ? part.text : images.place(part.data, part.mediaType)))
        .join("\n")

      sections.push(`## User\n\n${text}`)
      continue
    }

    if (message.role === "assistant") {
      const lines = message.content.flatMap((part) => {
        if (part.type === "text") return [part.text]
        if (part.type === "tool-call")
          return [
            `You called ${part.toolName} (call ${part.toolCallId}) with ${JSON.stringify(part.input)}`,
          ]

        return []
      })

      if (lines.length > 0) sections.push(`## You (assistant)\n\n${lines.join("\n")}`)
      continue
    }

    for (const part of message.content)
      if (part.type === "tool-result")
        sections.push(
          `## Result of ${part.toolName} (call ${part.toolCallId})\n\n${outputText(part.output, images)}`,
        )
  }

  return sections
}

/** The function tools the call offers, narrowed by its tool choice. */
function offered(options: LanguageModelV4CallOptions): LanguageModelV4FunctionTool[] {
  const tools = (options.tools ?? []).filter(
    (tool): tool is LanguageModelV4FunctionTool => tool.type === "function",
  )
  const choice = options.toolChoice

  if (choice?.type === "none") return []
  if (choice?.type === "tool") return tools.filter((tool) => tool.name === choice.toolName)

  return tools
}

/** The answer's JSON schema: calls of the offered tools, and text. Strict, so every CLI takes it. */
function answerSchema(tools: readonly LanguageModelV4FunctionTool[]): JSONSchema7 {
  return {
    type: "object",
    properties: {
      calls: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tool: { type: "string", enum: tools.map((tool) => tool.name) },
            input: { type: "string" },
          },
          required: ["tool", "input"],
          additionalProperties: false,
        },
      },
      text: { type: "string" },
    },
    required: ["calls", "text"],
    additionalProperties: false,
  }
}

/** What to answer: the tools and the JSON shape, or plain text, or JSON of the call's schema. */
function instructions(
  options: LanguageModelV4CallOptions,
  tools: readonly LanguageModelV4FunctionTool[],
): string {
  const noActions =
    "You cannot run commands, read or write files, or browse the web yourself; you only answer."

  if (tools.length > 0) {
    const listed = tools.map(
      (tool) =>
        `- ${tool.name}: ${tool.description ?? ""}\n  input schema: ${JSON.stringify(tool.inputSchema)}`,
    )
    const choice = options.toolChoice?.type
    const rule =
      choice === "required" || choice === "tool"
        ? "Make at least one call."
        : "Make calls when a tool helps; otherwise leave calls empty and answer in text."

    return [
      "## Tools",
      "",
      "These tools are carried out for you after you answer, in the order you list them:",
      "",
      ...listed,
      "",
      "## Your answer",
      "",
      `${noActions} Answer with one JSON object and nothing else: {"calls": [{"tool": "<a tool's name>", "input": "<the tool's input object, JSON-encoded as a string>"}], "text": "<anything to say, or an empty string>"}. ${rule}`,
    ].join("\n")
  }

  const format = options.responseFormat

  if (format?.type === "json")
    return [
      "## Your answer",
      "",
      `${noActions} Answer with only a JSON object${format.schema === undefined ? "" : ` that matches this schema: ${JSON.stringify(format.schema)}`}.`,
    ].join("\n")

  return `## Your answer\n\n${noActions} Answer the last message.`
}

/** The call as a CLI takes it; at most `maxImages` of its images go along, the newest. */
export function cliPrompt(options: LanguageModelV4CallOptions, maxImages: number): CliPrompt {
  const images = new Images(imageCount(options.prompt), maxImages)
  const tools = offered(options)
  const system = options.prompt
    .flatMap((message) => (message.role === "system" ? [message.content] : []))
    .join("\n\n")
  const text = [...transcript(options.prompt, images), instructions(options, tools)].join("\n\n")
  const warnings: SharedV4Warning[] = UNSUPPORTED.filter((key) => options[key] !== undefined).map(
    (feature) => ({ type: "unsupported", feature }),
  )

  return {
    system,
    text,
    images: images.kept,
    ...(tools.length > 0 && { schema: answerSchema(tools) }),
    warnings,
  }
}

const ANSWER = z.object({
  calls: z.array(
    z.object({ tool: z.string(), input: z.union([z.string(), z.record(z.string(), z.unknown())]) }),
  ),
  text: z.string().optional(),
})

/** The JSON object in `text`, which may sit in a fenced block. */
function parsedJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text

  try {
    return JSON.parse(fenced.trim())
  } catch {
    return undefined
  }
}

/** A tool input as the AI SDK takes it: JSON text. A string that is not JSON goes as it is. */
function inputText(input: string | Record<string, unknown>): string {
  return typeof input === "string" ? input : JSON.stringify(input)
}

/**
 * The CLI's answer as content. With tools, a JSON answer of the asked shape becomes its calls (the
 * AI SDK then checks each input against its tool); anything else comes back as text, which the
 * caller sees as an answer with no tool call. Without tools, the answer is text.
 */
export function answerContent(
  answer: string,
  withTools: boolean,
  nextId: () => string,
): LanguageModelV4Content[] {
  const parsed = withTools ? ANSWER.safeParse(parsedJson(answer)) : undefined

  if (parsed?.success !== true) return answer === "" ? [] : [{ type: "text", text: answer }]

  const text = parsed.data.text ?? ""

  return [
    ...(text === "" ? [] : [{ type: "text" as const, text }]),
    ...parsed.data.calls.map((call) => ({
      type: "tool-call" as const,
      toolCallId: nextId(),
      toolName: call.tool,
      input: inputText(call.input),
    })),
  ]
}
