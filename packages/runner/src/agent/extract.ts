/**
 * `agent.extract`: typed data read off the page. The model never supplies the values: it points
 * at the elements that hold them (by ref) and says how to read each one, and the runner reads the
 * page itself, so a value can only be what the page shows. The result must satisfy the caller's
 * schema. What was read where is recorded as targets, so a replay reads the same elements again
 * with no model call.
 */
import { generateText, type LanguageModel, type ModelMessage, type ToolCallPart, tool } from "ai"
import type { Locator, Page } from "playwright-core"
import { z } from "zod"

import type { Tabs } from "../browser/tabs.ts"
import { callCost, type CallCost } from "../model/resolve.ts"
import { describe, describeTarget, type Target } from "../replay/target.ts"
import { viewTabs, viewText } from "../snapshot/view.ts"
import { EXTRACT_PROMPT } from "./prompts.ts"

/** How a field's element is read: its text, a number in its text, or whether it is on. */
const readAs = z.enum(["text", "number", "boolean"])

export type ReadAs = z.infer<typeof readAs>

/** One field of the result, the element it comes from, and how to read it. */
export interface FieldSource {
  /** Where the value goes in the result: `balance`, `owner.name`, `items[0].price`. */
  readonly path: string
  readonly target: Target
  readonly as: ReadAs
}

const readInput = z.object({
  fields: z
    .array(
      z.object({
        path: z.string().describe("Where the value goes, e.g. `balance` or `items[0].name`."),
        ref: z.string().describe('The ref of the element that shows the value, e.g. "e12".'),
        as: readAs,
      }),
    )
    .min(1),
})

const failInput = z.object({ reason: z.string() })

const extractTools = {
  read: tool({
    description:
      "Read the result off the page: for every field, the element that shows its value and how to read it.",
    inputSchema: readInput,
    outputSchema: z.string(),
  }),
  fail: tool({
    description: "Give up: the page does not show what was asked for. Say why.",
    inputSchema: failInput,
    outputSchema: z.string(),
  }),
}

/** The extraction could not be done or did not fit the schema. */
export class ExtractFailed extends Error {
  constructor(instruction: string, reason: string) {
    super(`agent.extract(${JSON.stringify(instruction)}) failed: ${reason}`)
    this.name = "ExtractFailed"
  }
}

const NUMBER = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/
const TRUE_WORDS = /^(?:yes|true|on|enabled|active|checked)$/i

/** The number in `text`, e.g. 1234.5 from "$1,234.50"; undefined when there is none. */
function numberIn(text: string): number | undefined {
  const found = NUMBER.exec(text)?.[0]

  return found === undefined ? undefined : Number(found.replaceAll(",", ""))
}

async function textOf(element: Locator): Promise<string> {
  const field = await element.evaluate(
    (node) =>
      node instanceof HTMLInputElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLSelectElement,
  )

  if (!field) return (await element.innerText()).trim()
  if ((await element.getAttribute("type")) === "password")
    throw new Error("a password field is never read")

  return (await element.inputValue()).trim()
}

async function booleanOf(element: Locator): Promise<boolean> {
  const checkable = await element.evaluate(
    (node) =>
      (node instanceof HTMLInputElement && (node.type === "checkbox" || node.type === "radio")) ||
      ["checkbox", "switch", "radio"].includes(node.getAttribute("role") ?? ""),
  )

  return checkable ? element.isChecked() : TRUE_WORDS.test(await textOf(element))
}

/** Reads one element as `as`. */
async function readElement(element: Locator, as: ReadAs): Promise<unknown> {
  if (as === "boolean") return booleanOf(element)

  const text = await textOf(element)

  if (as === "text") return text

  const value = numberIn(text)

  if (value === undefined) throw new Error(`no number in ${JSON.stringify(text)}`)

  return value
}

/** Splits `items[0].price` into `["items", 0, "price"]`. */
function pathKeys(path: string): (string | number)[] {
  return path
    .replaceAll(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((key) => key !== "")
    .map((key) => (/^\d+$/.test(key) ? Number(key) : key))
}

/** `node` with `value` put at `keys`, creating objects and arrays on the way; `node` is left as it was. */
function withPath(node: unknown, keys: readonly (string | number)[], value: unknown): unknown {
  const [key, ...rest] = keys

  if (key === undefined) return value

  if (typeof key === "number") {
    const list: unknown[] = Array.isArray(node) ? [...node] : []

    list[key] = withPath(list[key], rest, value)

    return list
  }

  const record: Record<string, unknown> =
    typeof node === "object" && node !== null && !Array.isArray(node)
      ? Object.fromEntries(Object.entries(node))
      : {}

  record[key] = withPath(record[key], rest, value)

  return record
}

/** Reads every field from its element and checks the result against `schema`. */
export async function readFields<T>(
  fields: readonly { readonly path: string; readonly as: ReadAs; readonly element: Locator }[],
  schema: z.ZodType<T>,
): Promise<T> {
  let root: unknown = {}

  for (const field of fields)
    root = withPath(root, pathKeys(field.path), await readElement(field.element, field.as))

  const parsed = schema.safeParse(root)

  if (!parsed.success) throw new Error(z.prettifyError(parsed.error))

  return parsed.data
}

export interface ExtractContext {
  readonly model: Exclude<LanguageModel, string>
  readonly tabs: Tabs
  readonly redact: (text: string) => string
  readonly signal?: AbortSignal | undefined
  readonly onModelCall: (cost: CallCost) => void
}

export interface Extracted<T> {
  readonly value: T
  /** Where each field was read, to read it again on replay; null when one has no durable target. */
  readonly sources: readonly FieldSource[] | null
  readonly modelCalls: number
}

const MAX_TURNS = 4

function firstMessage(instruction: string, schema: z.ZodType, view: string): string {
  return [
    `Extract: ${instruction}`,
    `The result must match this JSON schema:\n${JSON.stringify(z.toJSONSchema(schema))}`,
    `The page now:\n${view}`,
  ].join("\n\n")
}

interface ReadCall {
  readonly fields: readonly { readonly path: string; readonly ref: string; readonly as: ReadAs }[]
}

/** Describes every field's element, while its ref still belongs to the latest view. */
async function sourcesOf(page: Page, tree: string, call: ReadCall): Promise<FieldSource[] | null> {
  const sources: FieldSource[] = []

  for (const field of call.fields) {
    const target = await describeTarget(page, tree, field.ref)

    if (target === undefined) return null
    sources.push({ path: field.path, target, as: field.as })
  }

  return sources
}

class ExtractLoop<T> {
  private readonly messages: ModelMessage[] = []
  private modelCalls = 0
  private readonly context: ExtractContext
  private readonly schema: z.ZodType<T>

  constructor(context: ExtractContext, schema: z.ZodType<T>) {
    this.context = context
    this.schema = schema
  }

  async run(instruction: string): Promise<Extracted<T>> {
    let view = await viewTabs(this.context.tabs, this.context.redact)

    this.messages.push({
      role: "user",
      content: firstMessage(instruction, this.schema, viewText(view)),
    })

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const call = await this.ask(instruction)
      const outcome = await this.tryRead(view.tree, call.input)

      if ("value" in outcome) return { ...outcome, modelCalls: this.modelCalls }

      view = await viewTabs(this.context.tabs, this.context.redact)
      this.messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: call.id,
            toolName: "read",
            output: {
              type: "text",
              value: `That did not work: ${outcome.problem}\n\nThe page now:\n${viewText(view)}`,
            },
          },
        ],
      })
    }

    throw new ExtractFailed(instruction, `no valid result within ${MAX_TURNS} tries`)
  }

  private async tryRead(
    tree: string,
    input: ReadCall,
  ): Promise<{ value: T; sources: FieldSource[] | null } | { problem: string }> {
    const page = this.context.tabs.page

    try {
      const sources = await sourcesOf(page, tree, input)
      const fields = input.fields.map((field) => ({ ...field, element: page.getByRef(field.ref) }))
      const value = await readFields(fields, this.schema)

      return { value, sources }
    } catch (error) {
      return {
        problem: this.context.redact(error instanceof Error ? error.message : String(error)),
      }
    }
  }

  /** One model turn; resolves with its read call, or throws when it gives up or answers wrong. */
  private async ask(instruction: string): Promise<{ id: string; input: ReadCall }> {
    const result = await generateText({
      model: this.context.model,
      system: EXTRACT_PROMPT,
      messages: this.messages,
      tools: extractTools,
      toolChoice: "required",
      ...(this.context.signal && { abortSignal: this.context.signal }),
    })

    this.modelCalls++
    this.context.onModelCall(callCost(result.usage, result.providerMetadata))
    this.messages.push(...result.response.messages)

    const call = result.response.messages
      .flatMap((message) =>
        message.role === "assistant" && typeof message.content !== "string" ? message.content : [],
      )
      .find((part): part is ToolCallPart => part.type === "tool-call")

    return this.parse(instruction, call)
  }

  private parse(instruction: string, call: ToolCallPart | undefined) {
    if (call?.toolName === "fail") this.gaveUp(instruction, call.input)

    const read = readInput.safeParse(call?.toolName === "read" ? call.input : undefined)

    if (call === undefined || !read.success)
      throw new ExtractFailed(instruction, "the model did not say where to read the result")

    return { id: call.toolCallId, input: read.data }
  }

  private gaveUp(instruction: string, input: unknown): never {
    const reason = failInput.safeParse(input).data?.reason ?? "gave up"

    throw new ExtractFailed(instruction, this.context.redact(reason))
  }
}

/** Has the model point at the elements that answer `instruction`, then reads them. */
export function extractLive<T>(
  instruction: string,
  schema: z.ZodType<T>,
  context: ExtractContext,
): Promise<Extracted<T>> {
  return new ExtractLoop(context, schema).run(instruction)
}

/** Labels of what a replay read, for the step's record. */
export function sourceLabels(sources: readonly FieldSource[]): string[] {
  return sources.map(
    (source) => `read ${source.path} from ${describe(source.target)} as ${source.as}`,
  )
}
