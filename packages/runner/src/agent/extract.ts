/**
 * `agent.extract`: typed data read off the page. The model never supplies the values: it points
 * at the elements that hold them (by ref) and says how to read each one, and the runner reads the
 * page itself, so a value can only be what the page shows. The result must satisfy the caller's
 * schema. What was read where is recorded as targets, so a replay reads the same elements again
 * with no model call.
 */
import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  type ToolCallPart,
  tool,
  type UserContent,
} from "ai"
import type { Locator, Page } from "playwright-core"
import { z } from "zod"

import type { Tabs } from "../browser/tabs.ts"
import { refusalOr, throwIfRefused } from "../model/refusal.ts"
import { callCost, type CallCost } from "../model/resolve.ts"
import { describe, describeKind, describeTarget, findAll, type Target } from "../replay/target.ts"
import { viewLimit } from "../snapshot/limit.ts"
import { type PageView, type ViewCut, viewTabs, viewText } from "../snapshot/view.ts"
import { DanwoError } from "../support/codes.ts"
import type { VisionDesk } from "../vision/desk.ts"
import { EXTRACT_VISION_GUIDE } from "../vision/prompts.ts"
import { hasGaps, visualGaps } from "../vision/screen.ts"
import { EXTRACT_PROMPT } from "./prompts.ts"

/** How a field's element is read: its text, a number in its text, or whether it is on. */
const readAs = z.enum(["text", "number", "boolean"])

/** On a page a field may also be a count: how many elements like the one pointed at there are. */
const pageReadAs = z.enum([...readAs.options, "count"])

export type PageReadAs = z.infer<typeof pageReadAs>

/** One field of the result, the element it comes from, and how to read it. */
export interface FieldSource {
  /** Where the value goes in the result: `balance`, `owner.name`, `items[0].price`. */
  readonly path: string
  readonly target: Target
  readonly as: PageReadAs
}

/** What a `read` call takes: each field, the element that shows it, and how to read it. */
function readInputOf<A extends z.ZodType>(as: A) {
  return z.object({
    fields: z
      .array(
        z.object({
          path: z.string().describe("Where the value goes, e.g. `balance` or `items[0].name`."),
          ref: z.string().describe('The ref of the element that shows the value, e.g. "e12".'),
          as,
        }),
      )
      .min(1),
  })
}

export const readInput = readInputOf(readAs)

const pageReadInput = readInputOf(pageReadAs)

const failInput = z.object({ reason: z.string() })

/** Values read off the screenshot, for what the text view does not show. */
const screenInput = z.object({
  fields: z
    .array(
      z.object({
        path: z.string().describe("Where the value goes, e.g. `balance` or `items[0].name`."),
        value: z.union([z.string(), z.number(), z.boolean()]),
        where: z.string().describe('Where on the screenshot it is, e.g. "the bar labelled March".'),
      }),
    )
    .min(1),
})

const extractTools = {
  read: tool({
    description:
      "Read the result off the page: for every field, the element that shows its value and how to read it.",
    inputSchema: pageReadInput,
    outputSchema: z.string(),
  }),
  fail: tool({
    description: "Give up: the page does not show what was asked for. Say why.",
    inputSchema: failInput,
    outputSchema: z.string(),
  }),
}

const visionTools = {
  ...extractTools,
  read_screen: tool({
    description:
      "Give values only the screenshot shows (a canvas, a chart, a frame the view cannot list), as you read them, and where each is.",
    inputSchema: screenInput,
    outputSchema: z.string(),
  }),
}

/** The extraction could not be done or did not fit the schema. */
export class ExtractFailed extends DanwoError {
  constructor(instruction: string, reason: string) {
    super("EXTRACT_FAILED", `agent.extract(${JSON.stringify(instruction)}) failed: ${reason}`)
    this.name = "ExtractFailed"
  }
}

const NUMBER = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/
const TRUE_WORDS = /^(?:yes|true|on|enabled|active|checked)$/i

/** The number in `text`, e.g. 1234.5 from "$1,234.50"; undefined when there is none. */
export function numberIn(text: string): number | undefined {
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

/** Reads one element as `as`; for a count, `element` is every element counted. */
async function readElement(element: Locator, as: PageReadAs): Promise<unknown> {
  if (as === "count") return element.count()
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
  fields: readonly { readonly path: string; readonly as: PageReadAs; readonly element: Locator }[],
  schema: z.ZodType<T>,
): Promise<T> {
  const values: { readonly path: string; readonly value: unknown }[] = []

  for (const field of fields)
    values.push({ path: field.path, value: await readElement(field.element, field.as) })

  return assembleFields(values, schema)
}

/** The result `values` make, each put at its path, checked against `schema`. */
export function assembleFields<T>(
  values: readonly { readonly path: string; readonly value: unknown }[],
  schema: z.ZodType<T>,
): T {
  let root: unknown = {}

  for (const field of values) root = withPath(root, pathKeys(field.path), field.value)

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
  /**
   * The step's vision: `always` shows a screenshot and offers `read_screen`; `auto` does when the
   * page has parts the text view misses.
   */
  readonly vision?: { readonly mode: "auto" | "always"; readonly desk: VisionDesk } | undefined
  /** Told each time the extractor's view of the page was cut to fit its model. */
  readonly onViewCut?: (cut: ViewCut) => void
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

type ReadCall = z.infer<typeof pageReadInput>

/** Where one field of a read call is read, and the element (or, for a count, elements) it reads. */
interface Located {
  readonly path: string
  readonly as: PageReadAs
  readonly element: Locator
  /** How a replay finds it again; undefined when nothing durable does. */
  readonly target: Target | undefined
}

/**
 * Finds every field's element, while its ref still belongs to the latest view. A count reads every
 * element like the one pointed at, so it needs a description of them; throws when there is none.
 */
async function locate(page: Page, tree: string, call: ReadCall): Promise<Located[]> {
  const located: Located[] = []

  for (const field of call.fields) {
    if (field.as !== "count") {
      const target = await describeTarget(page, tree, field.ref)

      located.push({ ...field, element: page.getByRef(field.ref), target })
      continue
    }

    const kind = await describeKind(page, tree, field.ref)

    if (kind === undefined)
      throw new Error(
        `${field.path}: the elements like [ref=${field.ref}] have no test id or role to count them by; point at one that has`,
      )
    located.push({ ...field, element: await findAll(page, kind, 0), target: kind })
  }

  return located
}

/** Where every field was read, to record; null when one has no durable target. */
function sourcesOf(located: readonly Located[]): FieldSource[] | null {
  const sources: FieldSource[] = []

  for (const { path, target, as } of located) {
    if (target === undefined) return null
    sources.push({ path, target, as })
  }

  return sources
}

/** A call the extractor made: where to read values, or values it read off the screenshot. */
type ExtractCall =
  | { readonly id: string; readonly kind: "read"; readonly input: ReadCall }
  | {
      readonly id: string
      readonly kind: "read_screen"
      readonly input: z.infer<typeof screenInput>
    }

type Attempt<T> = { value: T; sources: FieldSource[] | null } | { problem: string }

class ExtractLoop<T> {
  private readonly messages: ModelMessage[] = []
  private modelCalls = 0
  private readonly context: ExtractContext
  private readonly schema: z.ZodType<T>
  /** Whether the extractor is shown a screenshot and may read values off it. */
  private sees = false

  constructor(context: ExtractContext, schema: z.ZodType<T>) {
    this.context = context
    this.schema = schema
  }

  /** The page now, cut to fit the model; a cut is told to the step. */
  private async look(): Promise<PageView> {
    const { tabs, redact, model } = this.context
    const view = await viewTabs(tabs, redact, viewLimit(model))

    if (view.cut !== undefined) this.context.onViewCut?.(view.cut)

    return view
  }

  async run(instruction: string): Promise<Extracted<T>> {
    let view = await this.look()

    this.sees = await this.wantsScreen(view.tree)
    this.messages.push({
      role: "user",
      content: await this.opening(firstMessage(instruction, this.schema, viewText(view))),
    })

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const call = await this.ask(instruction)
      const outcome = await this.attempt(view.tree, call)

      if ("value" in outcome) return { ...outcome, modelCalls: this.modelCalls }

      view = await this.look()
      this.messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: call.id,
            toolName: call.kind,
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

  /** Whether to show a screenshot: always with vision always on, and on `auto` when the text misses parts. */
  private async wantsScreen(tree: string): Promise<boolean> {
    const vision = this.context.vision

    if (vision === undefined) return false
    if (vision.mode === "always") return true

    return hasGaps(await visualGaps(this.context.tabs.page, tree))
  }

  /** The first message: the text, with a screenshot when the extractor sees one. */
  private async opening(text: string): Promise<UserContent> {
    const desk = this.context.vision?.desk

    if (!this.sees || desk === undefined) return text

    const seen = await desk.look(this.context.tabs.page)

    return [
      { type: "text", text: `${text}\n\n${desk.describe(seen)}` },
      { type: "file", data: seen.png, mediaType: "image/png" },
    ]
  }

  private attempt(tree: string, call: ExtractCall): Promise<Attempt<T>> | Attempt<T> {
    return call.kind === "read" ? this.tryRead(tree, call.input) : this.tryScreen(call.input)
  }

  /** Values read off the screenshot, checked by the schema; they leave nothing to replay. */
  private tryScreen(input: z.infer<typeof screenInput>): Attempt<T> {
    let root: unknown = {}

    for (const field of input.fields) root = withPath(root, pathKeys(field.path), field.value)

    const parsed = this.schema.safeParse(root)

    return parsed.success
      ? { value: parsed.data, sources: null }
      : { problem: z.prettifyError(parsed.error) }
  }

  private async tryRead(tree: string, input: ReadCall): Promise<Attempt<T>> {
    const page = this.context.tabs.page

    try {
      const located = await locate(page, tree, input)
      const value = await readFields(located, this.schema)

      return { value, sources: sourcesOf(located) }
    } catch (error) {
      return {
        problem: this.context.redact(error instanceof Error ? error.message : String(error)),
      }
    }
  }

  /** One model turn; resolves with its read call, or throws when it gives up or answers wrong. */
  private async ask(instruction: string): Promise<ExtractCall> {
    const step = `the extraction ${JSON.stringify(instruction)}`
    const result = await generateText({
      model: this.context.model,
      system: this.sees ? `${EXTRACT_PROMPT}\n${EXTRACT_VISION_GUIDE}` : EXTRACT_PROMPT,
      messages: this.messages,
      tools: this.sees ? visionTools : extractTools,
      toolChoice: "required",
      ...(this.context.signal && { abortSignal: this.context.signal }),
    }).catch((error: unknown) => {
      throw refusalOr(error, step, this.context.model)
    })

    this.modelCalls++
    this.context.onModelCall(callCost(result.usage, result.providerMetadata))
    throwIfRefused(result, step, this.context.model)
    this.messages.push(...result.response.messages)

    const call = result.response.messages
      .flatMap((message) =>
        message.role === "assistant" && typeof message.content !== "string" ? message.content : [],
      )
      .find((part): part is ToolCallPart => part.type === "tool-call")

    return this.parse(instruction, call)
  }

  private parse(instruction: string, call: ToolCallPart | undefined): ExtractCall {
    if (call?.toolName === "fail") this.gaveUp(instruction, call.input)

    const parsed = call === undefined ? undefined : this.parseRead(call)

    if (parsed === undefined)
      throw new ExtractFailed(instruction, "the model did not say where to read the result")

    return parsed
  }

  /** A `read` call, or a `read_screen` one when the extractor sees a screenshot; undefined if neither. */
  private parseRead(call: ToolCallPart): ExtractCall | undefined {
    if (this.sees && call.toolName === "read_screen") {
      const screen = screenInput.safeParse(call.input)

      return screen.success
        ? { id: call.toolCallId, kind: "read_screen", input: screen.data }
        : undefined
    }

    const read = pageReadInput.safeParse(call.toolName === "read" ? call.input : undefined)

    return read.success ? { id: call.toolCallId, kind: "read", input: read.data } : undefined
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
