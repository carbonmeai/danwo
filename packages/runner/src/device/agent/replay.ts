/**
 * Replaying a recorded step on a device with no model: each action's target is found again on a
 * fresh reading of the screen (waiting for it to show), the action is done, and at the end the
 * device must be where the recording ended (the app, or the same page in the browser). An action
 * that can no longer be done is a mismatch; the caller then hands the step to the model, or, under
 * strict replay, stops there.
 */
import type { MailDesk } from "../../mail/desk.ts"
import { type Params, paramSecret, paramText } from "../../replay/params.ts"
import { ReplayMismatch } from "../../replay/replayer.ts"
import { describe } from "../../replay/target.ts"
import type {
  RecordedAction,
  RecordedInput,
  Target,
  Trace,
  VisualTarget,
} from "../../replay/trace.ts"
import type { Secret, SecretVault } from "../../secrets/index.ts"
import type { DeviceNode } from "../types.ts"
import {
  type ActContext,
  checkNode,
  dismissKeyboard,
  fillNode,
  goBack,
  longPressNode,
  openLink,
  pressKey,
  readUntil,
  scrollTo,
  selectOption,
  swipeOn,
  tapNode,
  tapPoint,
  typeAtPoint,
  waitForText,
} from "./act.ts"
import type { DeviceEyes } from "./eyes.ts"
import { findNode, type Finding } from "./target.ts"
import { deviceRoute } from "./view.ts"

/** How long a replay waits for a recorded element to show. */
const FIND_MS = 10_000

export interface DeviceReplayContext extends ActContext {
  readonly vault: SecretVault
  readonly params: Params
  readonly mail: MailDesk
  /** Whether a target that moved may be found where it is now. */
  readonly relocating: boolean
  readonly eyes: DeviceEyes
  readonly onAction: (label: string) => void
}

/** How a replay went: the recording with moved targets updated, and what moved. */
export interface DeviceReplayOutcome {
  readonly trace: Trace
  readonly moved: readonly { readonly from: string; readonly to: string }[]
}

/** Waits for `target` on the screen; the node, with where it moved when it did. */
async function locate(
  context: DeviceReplayContext,
  target: Target,
  index: number,
): Promise<{ readonly node: DeviceNode; readonly moved?: Target }> {
  let last: Finding = { missing: "matches nothing" }
  const found = await readUntil(context.target, Math.min(context.timeout, FIND_MS), (reading) => {
    last = findNode(reading.nodes, target, false)

    return "node" in last ? last : undefined
  })

  if (found !== undefined && "node" in found) return found

  /* Relocation looks once, on the screen as it settled, never while it is still changing. */
  if (context.relocating) {
    const settled = findNode((await context.target.read()).nodes, target, true)

    if ("node" in settled) return settled
    last = settled
  }

  throw new ReplayMismatch(
    index,
    `${describe(target)} ${"missing" in last ? last.missing : "is not there"}`,
  )
}

function secretOf(name: string, context: DeviceReplayContext): Secret {
  return paramSecret(context.params, name) ?? context.vault.handle(name)
}

/** The text a recorded input types on this run. */
async function inputText(input: RecordedInput, context: DeviceReplayContext): Promise<string> {
  if ("text" in input) return input.text
  if ("secret" in input) return context.vault.reveal(secretOf(input.secret, context))
  if ("mail" in input) throw new Error("values from mail are not replayed on a device yet")

  const text = paramText(context.params, input.param)

  if (text === undefined) throw new Error(`param "${input.param}" was not given`)

  return text
}

/** Finds a place recorded on a screenshot; a mismatch when it is not there. */
async function place(context: DeviceReplayContext, visual: VisualTarget, index: number) {
  const nodes = (await context.target.read()).nodes
  const found = await context.eyes.find(nodes, visual, context.relocating)

  if (typeof found === "string") throw new ReplayMismatch(index, found)

  return found
}

type ActionOf<Kind extends RecordedAction["kind"]> = Extract<RecordedAction, { kind: Kind }>

/** Replays one action of a kind; the target it moved to, when it did. */
type Replay<Kind extends RecordedAction["kind"]> = (
  action: ActionOf<Kind>,
  index: number,
  context: DeviceReplayContext,
) => Promise<Target | undefined>

/** The element an action aims at, waited for; and where it moved, when it did. */
async function aimed(
  context: DeviceReplayContext,
  target: Target | undefined,
  index: number,
): Promise<{ readonly node?: DeviceNode; readonly moved?: Target }> {
  return target === undefined ? {} : locate(context, target, index)
}

/** How each kind of action replays on a device; the rest cannot. */
const REPLAYS: { readonly [Kind in RecordedAction["kind"]]?: Replay<Kind> } = {
  click: async (action, index, context) => {
    const { node, moved } = await locate(context, action.target, index)

    await tapNode(context, node)

    return moved
  },
  fill: async (action, index, context) => {
    const { node, moved } = await locate(context, action.target, index)

    await fillNode(context, node, await inputText(action.input, context))

    return moved
  },
  check: async (action, index, context) => {
    const { node, moved } = await locate(context, action.target, index)

    await checkNode(context, node, action.checked)

    return moved
  },
  select: async (action, index, context) => {
    const { node, moved } = await locate(context, action.target, index)

    await selectOption(context, node, action.option)

    return moved
  },
  press: async (action, index, context) => {
    const { node, moved } = await aimed(context, action.target, index)

    await pressKey(context, action.key, node)

    return moved
  },
  scroll: async (action, index, context) => {
    const { node, moved } = await aimed(context, action.target, index)

    await scrollTo(context, action.direction ?? "down", node)

    return moved
  },
  swipe: async (action, index, context) => {
    const { node, moved } = await aimed(context, action.target, index)

    await swipeOn(context, action.direction, node, action.ms)

    return moved
  },
  long_press: async (action, index, context) => {
    const { node, moved } = await locate(context, action.target, index)

    await longPressNode(context, node, action.ms === undefined ? {} : { durationMs: action.ms })

    return moved
  },
  dismiss_keyboard: async (_action, _index, context) => {
    await dismissKeyboard(context)

    return undefined
  },
  back: async (_action, _index, context) => {
    await goBack(context)

    return undefined
  },
  navigate: async (action, _index, context) => {
    await openLink(context, action.url)

    return undefined
  },
  wait: async (action, index, context) => {
    const wait = { text: action.text, hidden: action.state === "hidden", ms: action.ms }

    await waitForText(context, wait).catch((error: unknown) => {
      throw new ReplayMismatch(index, error instanceof Error ? error.message : String(error))
    })

    return undefined
  },
  click_at: async (action, index, context) => {
    const found = await place(context, action.visual, index)

    await tapPoint(context, found.x, found.y)

    return undefined
  },
  type_at: async (action, index, context) => {
    const found = await place(context, action.visual, index)

    await typeAtPoint(context, found, await inputText(action.input, context))

    return undefined
  },
}

/** Replays one action; the target it moved to, when it did. */
async function replayAction(
  action: RecordedAction,
  index: number,
  context: DeviceReplayContext,
): Promise<Target | undefined> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- REPLAYS[kind] takes the action of that kind; TypeScript can't correlate the key with the union member
  const replay = REPLAYS[action.kind] as Replay<RecordedAction["kind"]> | undefined

  if (replay === undefined)
    throw new ReplayMismatch(index, `a ${action.kind} action cannot be replayed on a device`)

  return replay(action, index, context)
}

/** A short line for the step's record: what the action did. */
function labelOf(action: RecordedAction): string {
  if ("target" in action && action.target !== undefined)
    return `${action.kind} ${describe(action.target)}`
  if ("visual" in action) return `${action.kind} "${action.visual.description}"`

  return action.kind
}

/** Replays `trace`; throws ReplayMismatch at the first action that cannot be done. */
export async function replayOnDevice(
  trace: Trace,
  context: DeviceReplayContext,
): Promise<DeviceReplayOutcome> {
  const actions: RecordedAction[] = []
  const moved: { from: string; to: string }[] = []

  for (const [index, action] of trace.actions.entries()) {
    /* An action that fails on this screen (a field that no longer takes text) did not replay. */
    const to = await replayAction(action, index, context).catch((error: unknown) => {
      if (error instanceof ReplayMismatch || !(error instanceof Error)) throw error

      throw new ReplayMismatch(index, `${labelOf(action)}: ${error.message.split("\n")[0] ?? ""}`)
    })

    context.onAction(labelOf(action))

    if (to !== undefined && "target" in action && action.target !== undefined) {
      moved.push({ from: describe(action.target), to: describe(to) })
      actions.push({ ...action, target: to })
    } else actions.push(action)
  }

  const route = deviceRoute(await context.target.foreground())

  if (route !== trace.endRoute)
    throw new ReplayMismatch(trace.actions.length, `ended on ${route}, not ${trace.endRoute}`)

  return { trace: moved.length === 0 ? trace : { ...trace, actions }, moved }
}
