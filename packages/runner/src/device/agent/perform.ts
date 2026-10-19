/**
 * Carrying out one tool call of a live device step: find the element behind the ref in the latest
 * view, act on it, and describe what was done so a replay can do it again. The description is
 * taken from the same reading the ref belongs to.
 */
import type { MailDesk } from "../../mail/desk.ts"
import { embedsValue, paramSecret, type Params, paramTyped } from "../../replay/params.ts"
import type { RecordedAction, RecordedInput, Target } from "../../replay/trace.ts"
import type { SecretVault } from "../../secrets/index.ts"
import type { DeviceNode } from "../types.ts"
import {
  type ActContext,
  checkNode,
  fillNode,
  goBack,
  openLink,
  pressKey,
  scrollTo,
  selectOption,
  tapNode,
  tapPoint,
  typeAtPoint,
  waitForText,
} from "./act.ts"
import { type DeviceEyes, type Look, marksText, SCALE } from "./eyes.ts"
import { describeNode } from "./target.ts"
import type { DeviceCall, DeviceToolInput } from "./tools.ts"
import type { DeviceView } from "./view.ts"

export interface DevicePerformContext extends ActContext {
  /** The latest view, which the call's refs belong to. */
  readonly view: DeviceView
  readonly vault: SecretVault
  readonly params: Params
  /** Mail the app sent: values read from it are never recorded as written. */
  readonly mail: MailDesk
  /** The step's eyes, when it may see the screen. */
  readonly eyes?: DeviceEyes | undefined
  /** The latest look, whose marks and pixels `tap_at` and `type_at` mean. */
  readonly look?: Look | undefined
}

export interface DevicePerformed {
  /** What happened, for the model. */
  readonly outcome: string
  /** The action as recorded; null when it cannot be replayed (nothing durable to find it by). */
  readonly recorded: RecordedAction | null | undefined
  /** A look the call took, for the model. */
  readonly look?: Look
}

/** The element behind `ref` in the latest view. */
function nodeOf(context: DevicePerformContext, ref: string): DeviceNode {
  const node = context.view.nodes.find((each) => each.ref === ref)

  if (node === undefined) throw new Error(`there is no element [ref=${ref}] in the latest view`)

  return node
}

/**
 * How `node` is found again, without a name or text holding a param's value or a value read from
 * mail, which another run would not have. Undefined when nothing durable is left.
 */
function durableTarget(context: DevicePerformContext, node: DeviceNode): Target | undefined {
  const target = describeNode(context.view.nodes, node)
  const varies = (text: string | undefined) =>
    text !== undefined && embedsValue(text, context.params, context.mail.values())

  if (target === undefined || target.testId !== undefined) return target

  return varies(target.name) || varies(target.text) ? undefined : target
}

/** How typed text is recorded: the param it came from, or as written. */
function typedInput(context: DevicePerformContext, text: string): RecordedInput {
  const param = paramTyped(context.params, text)

  return param === undefined ? { text } : { param }
}

/** Runs `act` on the element behind `ref`, recording it with `record` when it is findable again. */
async function onNode(
  context: DevicePerformContext,
  ref: string,
  act: (node: DeviceNode) => Promise<void>,
  record: (target: Target) => RecordedAction,
): Promise<DevicePerformed> {
  const node = nodeOf(context, ref)
  const target = durableTarget(context, node)

  await act(node)

  return { outcome: "done", recorded: target === undefined ? null : record(target) }
}

async function fillSecret(
  context: DevicePerformContext,
  input: DeviceToolInput<"fill_secret">,
): Promise<DevicePerformed> {
  const secret = paramSecret(context.params, input.secret) ?? context.vault.handle(input.secret)
  const value = await context.vault.reveal(secret)
  const node = nodeOf(context, input.ref)

  context.eyes?.holdsSecret(node)

  return onNode(
    context,
    input.ref,
    (field) => fillNode(context, field, value),
    (target) => ({ kind: "fill", target, input: { secret: secret.name } }),
  )
}

/** The screen point a vision call means, in screen pixels: a mark's middle, or its x and y. */
function pointOf(
  context: DevicePerformContext,
  input: {
    readonly mark?: number | undefined
    readonly x?: number | undefined
    readonly y?: number | undefined
  },
): { readonly x: number; readonly y: number } {
  const look = context.look

  if (look === undefined) throw new Error("look at the screen first")

  const mark =
    input.mark === undefined ? undefined : look.marks.find((each) => each.number === input.mark)

  if (input.mark !== undefined && mark === undefined)
    throw new Error(`there is no mark ${input.mark}`)
  if (mark !== undefined) return { x: mark.x * SCALE, y: mark.y * SCALE }
  if (input.x === undefined || input.y === undefined) throw new Error("give a mark, or x and y")

  return { x: input.x * SCALE, y: input.y * SCALE }
}

async function lookNow(context: DevicePerformContext): Promise<DevicePerformed> {
  const look = await context.eyes?.look(context.view.nodes)

  if (look === undefined) return { outcome: "no screenshot could be taken", recorded: undefined }

  return { outcome: marksText(look, context.vault.redact), recorded: undefined, look }
}

async function tapAt(
  context: DevicePerformContext,
  input: DeviceToolInput<"tap_at">,
): Promise<DevicePerformed> {
  const point = pointOf(context, input)
  const visual = await context.eyes?.capture(context.view.nodes, point, input.description)

  await tapPoint(context, point.x, point.y)

  return { outcome: "done", recorded: visual === undefined ? null : { kind: "click_at", visual } }
}

async function typeAt(
  context: DevicePerformContext,
  input: DeviceToolInput<"type_at">,
): Promise<DevicePerformed> {
  const point = pointOf(context, input)
  const visual = await context.eyes?.capture(context.view.nodes, point, input.description)
  const secret =
    input.secret === undefined
      ? undefined
      : (paramSecret(context.params, input.secret) ?? context.vault.handle(input.secret))
  const text = secret === undefined ? (input.text ?? "") : await context.vault.reveal(secret)
  const typed: RecordedInput =
    secret === undefined ? typedInput(context, text) : { secret: secret.name }

  await typeAtPoint(context, point, text)

  return {
    outcome: "done",
    recorded: visual === undefined ? null : { kind: "type_at", visual, input: typed },
  }
}

/** A wait as recorded: for the text it waited on, unless the text varies from run to run. */
function recordedWait(
  context: DevicePerformContext,
  text: string | undefined,
  hidden: boolean,
  ms: number | undefined,
): RecordedAction | null {
  if (text !== undefined && embedsValue(text, context.params, context.mail.values())) return null

  return {
    kind: "wait",
    ...(text !== undefined && { text }),
    ...(hidden && { state: "hidden" as const }),
    ...(ms !== undefined && { ms }),
  }
}

async function waitFor(
  context: DevicePerformContext,
  input: DeviceToolInput<"wait_for">,
): Promise<DevicePerformed> {
  const node = input.ref === undefined ? undefined : nodeOf(context, input.ref)
  const text = input.text ?? (node && (node.name || node.text))
  const hidden = input.state === "hidden"

  await waitForText(context, { text, hidden, ms: input.ms })

  return { outcome: "done", recorded: recordedWait(context, text, hidden, input.ms) }
}

/** Presses a key: on the field `ref` when given, else on whatever has focus. */
function pressOn(
  context: DevicePerformContext,
  input: DeviceToolInput<"press_key">,
): Promise<DevicePerformed> {
  const { key, ref } = input

  if (ref === undefined)
    return pressKey(context, key, undefined).then(() => ({
      outcome: "done",
      recorded: { kind: "press", key },
    }))

  return onNode(
    context,
    ref,
    (node) => pressKey(context, key, node),
    (target) => ({ kind: "press", key, target }),
  )
}

/** Scrolls the element `ref` when given, else the screen. */
function scrollOn(
  context: DevicePerformContext,
  input: DeviceToolInput<"scroll">,
): Promise<DevicePerformed> {
  const { direction, ref } = input

  if (ref === undefined)
    return scrollTo(context, direction, undefined).then(() => ({
      outcome: "done",
      recorded: { kind: "scroll", direction },
    }))

  return onNode(
    context,
    ref,
    (node) => scrollTo(context, direction, node),
    (target) => ({ kind: "scroll", direction, target }),
  )
}

async function openOn(
  context: DevicePerformContext,
  input: DeviceToolInput<"open_link">,
): Promise<DevicePerformed> {
  const varies = embedsValue(input.url, context.params, context.mail.values())

  await openLink(context, input.url)

  return { outcome: "done", recorded: varies ? null : { kind: "navigate", url: input.url } }
}

/** Carries out one call of a tool. */
type Perform<Name extends DeviceCall["name"]> = (
  context: DevicePerformContext,
  input: Extract<DeviceCall, { name: Name }>["input"],
) => Promise<DevicePerformed>

/** How each tool is carried out. */
const PERFORMS: { readonly [Name in DeviceCall["name"]]: Perform<Name> } = {
  tap: (context, input) =>
    onNode(
      context,
      input.ref,
      (node) => tapNode(context, node),
      (target) => ({ kind: "click", target }),
    ),
  fill: (context, input) =>
    onNode(
      context,
      input.ref,
      (node) => fillNode(context, node, input.text),
      (target) => ({ kind: "fill", target, input: typedInput(context, input.text) }),
    ),
  fill_secret: fillSecret,
  check: (context, input) =>
    onNode(
      context,
      input.ref,
      (node) => checkNode(context, node, input.checked),
      (target) => ({ kind: "check", target, checked: input.checked }),
    ),
  select: (context, input) =>
    onNode(
      context,
      input.ref,
      (node) => selectOption(context, node, input.option),
      (target) => ({ kind: "select", target, option: input.option }),
    ),
  press_key: pressOn,
  scroll: scrollOn,
  back: async (context) => {
    await goBack(context)

    return { outcome: "done", recorded: { kind: "back" } }
  },
  open_link: openOn,
  wait_for: waitFor,
  look: (context) => lookNow(context),
  tap_at: tapAt,
  type_at: typeAt,
}

/** Carries out one call. */
export function performOnDevice(
  call: DeviceCall,
  context: DevicePerformContext,
): Promise<DevicePerformed> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- PERFORMS[name] takes that tool's input; TypeScript can't correlate the key with the union member
  const perform = PERFORMS[call.name] as Perform<DeviceCall["name"]>

  return perform(context, call.input)
}
