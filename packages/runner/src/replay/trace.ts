/**
 * A recording of one `agent.act` step: the actions that carried it out, each on a described
 * target, and the route the browser ended on. Typed text is kept as written unless it came from a
 * param (stored by the param's name) or a secret (stored by the secret's name, never its value).
 */
import { z } from "zod"

import { effectsSchema } from "./effects.ts"

/** How a recorded action's element is found again; see target.ts. */
const target = z.object({
  testId: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  nth: z.number().int().nonnegative().optional(),
  /** The part of the page it sat in, e.g. `form "Billing"`; helps find it again if it moved. */
  section: z.string().optional(),
  /**
   * The frames it sits in, outermost first, each as a CSS selector of its `<iframe>` within the
   * document around it, e.g. `iframe[title="Card"]`; absent for the page itself.
   */
  frame: z.array(z.string()).min(1).optional(),
})

/**
 * A place on the page found by how it looks, for actions taken on a screenshot (see
 * vision/visual.ts): a gray patch of the screen around the point, the element it sat in and where
 * in that element as fractions of its box, and where on the screen it was.
 */
const visual = z.object({
  description: z.string(),
  /** A PNG, base64, of the screen around the point; secret fields painted over. */
  patch: z.string(),
  point: z.object({ x: z.number(), y: z.number() }),
  anchor: z.object({ css: z.string(), at: z.object({ x: z.number(), y: z.number() }) }).optional(),
})

/** An email address as recorded: as written, or the param it came from. */
const address = z.union([z.object({ text: z.string() }), z.object({ param: z.string() })])

/**
 * A value taken from mail the app sent: from the newest mail to `to`, its code or a link. A replay
 * reads it from the emulator again, so the recording never holds the value itself.
 */
const fromMail = z.object({
  to: address,
  kind: z.enum(["code", "link"]),
  match: z.string().optional(),
  digits: z.number().int().positive().optional(),
})

const input = z.union([
  z.object({ text: z.string() }),
  z.object({ param: z.string() }),
  z.object({ secret: z.string() }),
  z.object({ mail: fromMail }),
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
  /** A navigation; `mail` when the URL was a link from an email, read again on replay. */
  z.object({ kind: z.literal("navigate"), url: z.string(), mail: fromMail.optional() }),
  /** The newest mail to an address, shown in the active tab. */
  z.object({ kind: z.literal("open_mail"), to: address }),
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
  /** Actions taken on a screenshot, each at a place found again by how it looks. */
  z.object({ kind: z.literal("click_at"), visual, opensTab }),
  z.object({ kind: z.literal("type_at"), visual, input }),
  z.object({ kind: z.literal("drag_at"), visual, to: visual }),
  z.object({ kind: z.literal("scroll_at"), visual, direction: z.enum(["up", "down"]) }),
])

/**
 * What a recording was made for: the parts of its key, kept with it so a step that misses can say
 * which recording of the same step exists and what changed (see store.ts).
 */
const identity = z.object({
  format: z.number(),
  projectId: z.string(),
  journey: z.string(),
  appIdentity: z.string(),
  kind: z.enum(["act", "extract", "wait"]),
  /** Zero-based position among the journey's agent steps; not part of the key. */
  step: z.number().int().nonnegative(),
  instruction: z.string(),
  params: z.record(z.string(), z.string()),
  policy: z.string(),
})

export type StepIdentity = z.infer<typeof identity>

export const traceSchema = z.object({
  version: z.literal(1),
  instruction: z.string(),
  recordedAt: z.string(),
  actions: z.array(action),
  /** The route the browser was on when the step ended (see route.ts). */
  endRoute: z.string(),
  /** What the step changed on the page and behind it; a replay must change the same (effects.ts). */
  effects: effectsSchema.optional(),
  identity: identity.optional(),
})

/** The fields every recording file has, whichever kind of step made it. */
export const storedSchema = z.object({
  instruction: z.string(),
  recordedAt: z.string(),
  identity: identity.optional(),
})

export type Trace = z.infer<typeof traceSchema>
export type RecordedAction = Trace["actions"][number]
export type RecordedInput = z.infer<typeof input>
export type RecordedAddress = z.infer<typeof address>
export type FromMail = z.infer<typeof fromMail>
export type Target = z.infer<typeof target>
export type VisualTarget = z.infer<typeof visual>

/** A recording of one `agent.extract` step: where each field of the result was read. */
export const extractTraceSchema = z.object({
  version: z.literal(1),
  kind: z.literal("extract"),
  instruction: z.string(),
  recordedAt: z.string(),
  fields: z
    .array(z.object({ path: z.string(), target, as: z.enum(["text", "number", "boolean"]) }))
    .min(1),
  identity: identity.optional(),
})

export type ExtractTrace = z.infer<typeof extractTraceSchema>

/**
 * A recording of one `agent.waitFor` step: the text whose presence showed the condition held, so a
 * replay waits for that text to appear and needs no model.
 */
export const waitTraceSchema = z.object({
  version: z.literal(1),
  kind: z.literal("wait"),
  instruction: z.string(),
  recordedAt: z.string(),
  evidence: z.object({ text: z.string().min(1) }),
  identity: identity.optional(),
})

export type WaitTrace = z.infer<typeof waitTraceSchema>
