/**
 * A recording of one `agent.act` step: the actions that carried it out, each on a described
 * target, and the route the browser ended on. Typed text is kept as written unless it came from a
 * param (stored by the param's name) or a secret (stored by the secret's name, never its value).
 */
import { z } from "zod"

/** How a recorded action's element is found again; see target.ts. */
const target = z.object({
  testId: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  nth: z.number().int().nonnegative().optional(),
  /** The part of the page it sat in, e.g. `form "Billing"`; helps find it again if it moved. */
  section: z.string().optional(),
})

const input = z.union([
  z.object({ text: z.string() }),
  z.object({ param: z.string() }),
  z.object({ secret: z.string() }),
])

/** Set on an action that opened a new tab, so a replay waits for that tab before going on. */
const opensTab = z.boolean().optional()

const action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), target, opensTab }),
  z.object({ kind: z.literal("fill"), target, input }),
  z.object({ kind: z.literal("press"), key: z.string(), target: target.optional(), opensTab }),
  z.object({ kind: z.literal("select"), target, option: z.string() }),
  z.object({ kind: z.literal("check"), target, checked: z.boolean() }),
  z.object({ kind: z.literal("hover"), target }),
  /** Files by the names the step declared them under; never paths. */
  z.object({ kind: z.literal("upload"), target, files: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal("drag"), target, to: target }),
  /** The answer to the dialog the action before it opened; a prompt's text as `input`. */
  z.object({ kind: z.literal("dialog"), accept: z.boolean(), input: input.optional() }),
  z.object({
    kind: z.literal("scroll"),
    direction: z.enum(["up", "down"]).optional(),
    target: target.optional(),
  }),
  z.object({ kind: z.literal("navigate"), url: z.string() }),
  z.object({ kind: z.literal("back") }),
  z.object({ kind: z.literal("switch_tab"), tab: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal("wait"),
    text: z.string().optional(),
    target: target.optional(),
    state: z.enum(["visible", "hidden"]).optional(),
    networkIdle: z.boolean().optional(),
    ms: z.number().optional(),
  }),
])

export const traceSchema = z.object({
  version: z.literal(1),
  instruction: z.string(),
  recordedAt: z.string(),
  actions: z.array(action),
  /** The route the browser was on when the step ended (see route.ts). */
  endRoute: z.string(),
})

export type Trace = z.infer<typeof traceSchema>
export type RecordedAction = Trace["actions"][number]
export type RecordedInput = z.infer<typeof input>
export type Target = z.infer<typeof target>

/** A recording of one `agent.extract` step: where each field of the result was read. */
export const extractTraceSchema = z.object({
  version: z.literal(1),
  kind: z.literal("extract"),
  instruction: z.string(),
  recordedAt: z.string(),
  fields: z
    .array(z.object({ path: z.string(), target, as: z.enum(["text", "number", "boolean"]) }))
    .min(1),
})

export type ExtractTrace = z.infer<typeof extractTraceSchema>
