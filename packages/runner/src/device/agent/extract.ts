/**
 * `agent.extract` on a device: the model points at the elements that show each value (by ref) and
 * says how to read them; the runner reads the screen itself, so a value can only be what the
 * screen shows. What was read where is recorded as targets, so a replay reads the same elements
 * again with no model call.
 */
import { generateText, type LanguageModel, type ModelMessage, type ToolCallPart, tool } from "ai"
import { z } from "zod"

import {
  assembleFields,
  ExtractFailed,
  type FieldSource,
  numberIn,
  type PageReadAs,
  readInput,
} from "../../agent/extract.ts"
import { toolCallsOf } from "../../agent/loop.ts"
import { refusalOr, throwIfRefused } from "../../model/refusal.ts"
import { callCost, type CallCost } from "../../model/resolve.ts"
import { describe } from "../../replay/target.ts"
import { textOf } from "../match.ts"
import type { DeviceNode } from "../types.ts"
import { DEVICE_EXTRACT_PROMPT } from "./prompts.ts"
import { describeNode, findNode } from "./target.ts"
import { type DeviceView, deviceViewText } from "./view.ts"

const tools = {
  read: tool({
    description:
      "Read the result off the screen: for every field, the element that shows its value and how to read it.",
    inputSchema: readInput,
    outputSchema: z.string(),
  }),
  fail: tool({
    description: "Give up: the screen does not show what was asked for. Say why.",
    inputSchema: z.object({ reason: z.string() }),
    outputSchema: z.string(),
  }),
}

const MAX_TURNS = 4
const TRUE_WORDS = /^(?:yes|true|on|enabled|active|checked)$/i

/** Reads one element as `as`; a password field is never read, and a screen's elements not counted. */
function readNode(nodes: readonly DeviceNode[], node: DeviceNode, as: PageReadAs): unknown {
  if (node.password) throw new Error("a password field is never read")
  if (as === "count") throw new Error("elements are counted only on a web page")
  if (as === "boolean") return node.checked ?? TRUE_WORDS.test(textOf(nodes, node))

  const text = node.editable ? (node.value ?? "") : textOf(nodes, node)

  if (as === "text") return text

  const value = numberIn(text)

  if (value === undefined) throw new Error(`no number in ${JSON.stringify(text)}`)

  return value
}

export interface DeviceExtractContext {
  readonly model: Exclude<LanguageModel, string>
  readonly look: () => Promise<DeviceView>
  readonly signal?: AbortSignal | undefined
  readonly onModelCall: (cost: CallCost) => void
}

/** A read call as the model made it. */
type ReadCall = z.infer<typeof readInput>

/** Reads the fields a `read` call names; the sources to record, or why it did not fit. */
function readCall<T>(
  view: DeviceView,
  call: ReadCall,
  schema: z.ZodType<T>,
): { readonly value: T; readonly sources: FieldSource[] | null } | { readonly problem: string } {
  const values: { path: string; value: unknown }[] = []
  const sources: FieldSource[] = []
  let replayable = true

  for (const field of call.fields) {
    const node = view.nodes.find((each) => each.ref === field.ref)

    if (node === undefined) return { problem: `there is no element [ref=${field.ref}]` }

    try {
      values.push({ path: field.path, value: readNode(view.nodes, node, field.as) })
    } catch (error) {
      return { problem: `${field.path}: ${error instanceof Error ? error.message : String(error)}` }
    }

    const target = describeNode(view.nodes, node)

    if (target === undefined) replayable = false
    else sources.push({ path: field.path, target, as: field.as })
  }

  try {
    return { value: assembleFields(values, schema), sources: replayable ? sources : null }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }
}

/** A read the model answered with, as one turn came to it. */
type Answer<T> =
  | { readonly value: T; readonly sources: FieldSource[] | null }
  | { readonly problem: string; readonly call: ToolCallPart | undefined }

/** Asks the model once; what its call read, or what did not fit. */
async function askOnce<T>(
  instruction: string,
  schema: z.ZodType<T>,
  view: DeviceView,
  messages: ModelMessage[],
  context: DeviceExtractContext,
): Promise<Answer<T>> {
  const step = `the extraction ${JSON.stringify(instruction)}`
  const result = await generateText({
    model: context.model,
    system: DEVICE_EXTRACT_PROMPT,
    messages,
    tools,
    toolChoice: "required",
    ...(context.signal && { abortSignal: context.signal }),
  }).catch((error: unknown) => {
    throw refusalOr(error, step, context.model)
  })

  context.onModelCall(callCost(result.usage, result.providerMetadata))
  throwIfRefused(result, step, context.model)
  messages.push(...result.response.messages)

  const call = toolCallsOf(result.response.messages).at(0)

  if (call?.toolName === "fail") {
    const reason = z.object({ reason: z.string() }).safeParse(call.input)

    throw new ExtractFailed(instruction, reason.success ? reason.data.reason : "the model gave up")
  }

  const parsed = readInput.safeParse(call?.input)
  const read = parsed.success
    ? readCall(view, parsed.data, schema)
    : { problem: "call read with fields" }

  return "value" in read ? read : { ...read, call }
}

/** Tells the model why its read did not fit, with the screen now. */
function retryMessage(
  call: ToolCallPart | undefined,
  problem: string,
  view: DeviceView,
): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: call?.toolCallId ?? "none",
        toolName: call?.toolName ?? "read",
        output: {
          type: "text",
          value: `That did not fit: ${problem}\n\nThe screen now:\n${deviceViewText(view)}`,
        },
      },
    ],
  }
}

/** Asks the model where the values are, until they fit `schema`. */
export async function extractOnDevice<T>(
  instruction: string,
  schema: z.ZodType<T>,
  context: DeviceExtractContext,
): Promise<{
  readonly value: T
  readonly sources: readonly FieldSource[] | null
  readonly modelCalls: number
}> {
  let view = await context.look()
  const messages: ModelMessage[] = [
    {
      role: "user",
      content: `Extract: ${instruction}\nThe result must match this JSON schema:\n${JSON.stringify(z.toJSONSchema(schema))}\n\nThe screen now:\n${deviceViewText(view)}`,
    },
  ]

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const answer = await askOnce(instruction, schema, view, messages, context)

    if ("value" in answer) return { ...answer, modelCalls: turn + 1 }

    view = await context.look()
    messages.push(retryMessage(answer.call, answer.problem, view))
  }

  throw new ExtractFailed(instruction, `no valid result within ${MAX_TURNS} tries`)
}

/** Reads recorded sources again in one reading; a reason when one is not on the screen. */
export function readSources<T>(
  nodes: readonly DeviceNode[],
  sources: readonly FieldSource[],
  schema: z.ZodType<T>,
): { readonly value: T } | { readonly reason: string } {
  const values: { path: string; value: unknown }[] = []

  for (const source of sources) {
    const found = findNode(nodes, source.target, false)

    if (!("node" in found)) return { reason: `${describe(source.target)} ${found.missing}` }

    try {
      values.push({ path: source.path, value: readNode(nodes, found.node, source.as) })
    } catch (error) {
      return { reason: error instanceof Error ? error.message : String(error) }
    }
  }

  try {
    return { value: assembleFields(values, schema) }
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) }
  }
}
