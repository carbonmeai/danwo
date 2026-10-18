/**
 * Playing a recording back: every action on the element its target describes, then a check that
 * the browser ended where it did when the step was recorded. Anything that no longer matches stops
 * the replay with the reason; nothing is guessed.
 */
import type { Locator } from "playwright-core"

import { filePaths, type Files } from "../agent/files.ts"
import {
  type Aftermath,
  type Operation,
  operate,
  scroll,
  waitFor,
  watched,
} from "../agent/operate.ts"
import type { Tabs } from "../browser/tabs.ts"
import type { MailDesk } from "../mail/desk.ts"
import { checkSecretField } from "../secrets/fields.ts"
import type { SecretVault } from "../secrets/index.ts"
import type { SecretSpots } from "../vision/screen.ts"
import { paramSecret, type Params, paramText } from "./params.ts"
import { type VisionReplayContext, visionReplays } from "./replay-vision.ts"
import { routeOf } from "./route.ts"
import { describe, findTarget, locatorFor, type Target } from "./target.ts"
import type { FromMail, RecordedAction, RecordedAddress, RecordedInput, Trace } from "./trace.ts"

const ROUTE_POLL_MS = 100
/** A recorded element that is not back within this long is gone: the page changed. */
const FIND_MS = 5_000

/** Why a recording no longer replays. */
export class ReplayMismatch extends Error {
  /** Which recorded action stopped matching (0-based), or the action count for the end route. */
  readonly action: number

  constructor(action: number, message: string) {
    super(message)
    this.name = "ReplayMismatch"
    this.action = action
  }
}

/** Finds a recorded target on the active tab; relocation may plug in here. */
export type TargetFinder = (target: Target, timeout: number) => Promise<Located>

/** An element a recorded target led to, and the target it was found by. */
export interface Located {
  readonly element: Locator
  /** The target that found it: the recorded one, or a new one when the element moved. */
  readonly target: Target
}

export interface ReplayContext {
  readonly tabs: Tabs
  readonly appUrl: string
  readonly vault: SecretVault
  readonly params: Params
  readonly files: Files
  readonly timeout: number
  /** Called with a label after each action, for the step's record. */
  readonly onAction: (label: string) => void
  /** How a recorded target is found; exact matching by default. */
  readonly find?: TargetFinder
  /** Waits, after an action, for the page and the backend to go quiet (see readiness.ts). */
  readonly ready: () => Promise<void>
  /** Mail the app sent, where values a recording took from mail are read again. */
  readonly mail: MailDesk
  /** Fields secrets went into, painted over in the screenshots places are looked for on. */
  readonly spots?: SecretSpots
  /** Moves time forward, for recordings that travelled in time. */
  readonly travel?: ((ms: number) => Promise<void>) | undefined
}

/** The handle of a recorded secret: the step's param of that name, else the session's secret. */
function secretOf(name: string, context: ReplayContext) {
  return paramSecret(context.params, name) ?? context.vault.handle(name)
}

/** An address as this run has it: as recorded, or the value of the param it came from. */
function addressText(address: RecordedAddress, context: ReplayContext): string {
  if ("text" in address) return address.text

  const text = paramText(context.params, address.param)

  if (text === undefined) throw new Error(`param "${address.param}" was not given`)

  return text
}

/** The value a recording took from mail, read again from the mail of this run. */
async function mailValue(from: FromMail, context: ReplayContext): Promise<string> {
  const to = addressText(from.to, context)
  const value = await context.mail.value(
    to,
    { kind: from.kind, match: from.match, digits: from.digits },
    Math.min(context.timeout, FIND_MS),
  )

  if (value === undefined) throw new Error(`no mail to ${to} with a ${from.kind} arrived`)

  return value
}

async function inputText(input: RecordedInput, context: ReplayContext): Promise<string> {
  if ("text" in input) return input.text
  if ("secret" in input) return context.vault.reveal(secretOf(input.secret, context))
  if ("mail" in input) return mailValue(input.mail, context)

  return addressText(input, context)
}

/** Exact finding: the one element the target describes on the active tab. */
function exactly(context: ReplayContext): TargetFinder {
  return async (target, timeout) => ({
    element: await findTarget(context.tabs.page, target, timeout),
    target,
  })
}

function locate(context: ReplayContext, target: Target): Promise<Located> {
  const find = context.find ?? exactly(context)

  return find(target, Math.min(context.timeout, FIND_MS))
}

type ActionOf<Kind extends RecordedAction["kind"]> = Extract<RecordedAction, { kind: Kind }>

/** An element action: the target it aims at and what it does there. */
interface Aimed {
  readonly target: Target
  readonly operation: Operation
}

type Aim<Kind extends RecordedAction["kind"]> = (
  action: ActionOf<Kind>,
  context: ReplayContext,
) => Promise<Aimed | undefined> | Aimed | undefined

/** For each action aimed at one element, what it does there; page actions are not listed. */
const aims: { readonly [Kind in RecordedAction["kind"]]?: Aim<Kind> } = {
  click: (action) => ({ target: action.target, operation: { kind: "click" } }),
  fill: async (action, context) => ({
    target: action.target,
    operation: { kind: "fill", text: await inputText(action.input, context) },
  }),
  select: (action) => ({
    target: action.target,
    operation: { kind: "select", option: action.option },
  }),
  check: (action) => ({
    target: action.target,
    operation: { kind: "check", checked: action.checked },
  }),
  hover: (action) => ({ target: action.target, operation: { kind: "hover" } }),
  upload: (action, context) => ({
    target: action.target,
    operation: { kind: "upload", paths: filePaths(context.files, action.files) },
  }),
  press: (action) =>
    action.target && { target: action.target, operation: { kind: "press", key: action.key } },
  scroll: (action) =>
    action.target && { target: action.target, operation: { kind: "scroll-into-view" } },
}

/** The operation an element action performs; undefined for actions on the page as a whole. */
async function operationOf(
  action: RecordedAction,
  context: ReplayContext,
): Promise<Aimed | undefined> {
  return aimAt(action.kind, action, context)
}

/** Runs the aim for `kind`, if element actions of that kind have one. */
function aimAt<Kind extends RecordedAction["kind"]>(
  kind: Kind,
  action: ActionOf<Kind>,
  context: ReplayContext,
): Promise<Aimed | undefined> | Aimed | undefined {
  const aim: Aim<Kind> | undefined = aims[kind]

  return aim?.(action, context)
}

/** What one replayed action did: its label, any dialog it opened, and moved targets. */
interface Replayed {
  readonly label: string
  readonly after?: Aftermath
  /** Recorded targets that were found somewhere else, with where. */
  readonly moved: readonly { readonly from: Target; readonly to: Target }[]
  /** The action as it is now, when a place it acts at was found somewhere else on the screen. */
  readonly revised?: RecordedAction
  /** Places found somewhere else on the screen, described for the step's record. */
  readonly movedPlaces?: readonly { readonly from: string; readonly to: string }[]
}

function moves(found: readonly { recorded: Target; located: Located }[]) {
  return found
    .filter(({ recorded, located }) => located.target !== recorded)
    .map(({ recorded, located }) => ({ from: recorded, to: located.target }))
}

async function onElement(
  action: RecordedAction,
  aimed: { target: Target; operation: Operation },
  context: ReplayContext,
): Promise<Replayed> {
  const located = await locate(context, aimed.target)
  const found = [{ recorded: aimed.target, located }]
  const opensTab = "opensTab" in action && action.opensTab === true

  /* The element may have moved: a recorded secret still only goes where its purpose allows. */
  if (action.kind === "fill" && "secret" in action.input)
    await checkSecretField(located.element, secretOf(action.input.secret, context), context.timeout)
  const after = await watched(
    context.tabs,
    () => operate(located.element, aimed.operation, context.timeout),
    { timeout: context.timeout, expectTab: opensTab },
  )

  if (opensTab && !after.openedTab) throw new Error("the tab it opened did not open")

  return { label: `${action.kind} ${describe(located.target)}`, after, moved: moves(found) }
}

async function dragged(
  action: Extract<RecordedAction, { kind: "drag" }>,
  context: ReplayContext,
): Promise<Replayed> {
  const from = await locate(context, action.target)
  const to = await locate(context, action.to)
  const after = await watched(
    context.tabs,
    () => operate(from.element, { kind: "drag", to: to.element }, context.timeout),
    { timeout: context.timeout },
  )

  return {
    label: `drag ${describe(from.target)} to ${describe(to.target)}`,
    after,
    moved: moves([
      { recorded: action.target, located: from },
      { recorded: action.to, located: to },
    ]),
  }
}

async function answered(
  action: Extract<RecordedAction, { kind: "dialog" }>,
  context: ReplayContext,
): Promise<string> {
  const open = await Promise.race([
    context.tabs.dialogOpened(),
    new Promise<undefined>((resolve) => setTimeout(resolve, Math.min(context.timeout, FIND_MS))),
  ])

  if (open === undefined) throw new Error("the dialog it answered did not open")

  const text = action.input === undefined ? undefined : await inputText(action.input, context)

  await context.tabs.answer(action.accept, text)

  return `${action.accept ? "accept" : "dismiss"} ${open.type} dialog`
}

async function waited(
  action: Extract<RecordedAction, { kind: "wait" }>,
  context: ReplayContext,
): Promise<Replayed> {
  /* An element that should go away may already be gone, so it is not looked for first. */
  const hidden = action.state === "hidden"
  const located =
    action.target === undefined
      ? undefined
      : hidden
        ? { element: locatorFor(context.tabs.page, action.target), target: action.target }
        : await locate(context, action.target)

  await waitFor(
    context.tabs.page,
    {
      text: action.text,
      element: located?.element,
      state: action.state,
      networkIdle: action.networkIdle,
      ms: action.ms,
    },
    context.timeout,
  )

  return {
    label: "wait",
    moved: located && action.target ? moves([{ recorded: action.target, located }]) : [],
  }
}

async function pressed(
  action: Extract<RecordedAction, { kind: "press" }>,
  context: ReplayContext,
): Promise<Replayed> {
  const after = await watched(context.tabs, () => context.tabs.page.keyboard.press(action.key), {
    timeout: context.timeout,
    expectTab: action.opensTab === true,
  })

  return { label: `press ${action.key}`, after, moved: [] }
}

type OnPage<Kind extends RecordedAction["kind"]> = (
  action: ActionOf<Kind>,
  context: ReplayContext,
) => Promise<Replayed>

/** Actions on the page as a whole: keys, scrolls, navigation, tabs, dialogs, drags and waits. */
const pageActions: { readonly [Kind in RecordedAction["kind"]]?: OnPage<Kind> } = {
  press: pressed,
  scroll: async (action, context) => {
    const direction = action.direction ?? "down"

    await scroll(context.tabs.page, direction)

    return { label: `scroll ${direction}`, moved: [] }
  },
  navigate: async (action, context) => {
    const url = action.mail === undefined ? action.url : await mailValue(action.mail, context)

    await context.tabs.page.goto(new URL(url, context.appUrl).href, { timeout: context.timeout })

    return { label: `navigate ${action.url}`, moved: [] }
  },
  open_mail: async (action, context) => {
    const to = addressText(action.to, context)

    if (!(await context.mail.open(context.tabs.page, to, Math.min(context.timeout, FIND_MS))))
      throw new Error(`no mail to ${to} arrived`)

    return { label: "open mail", moved: [] }
  },
  travel_time: async (action, context) => {
    if (context.travel === undefined) throw new Error("this session cannot travel in time")

    await context.travel(action.ms)

    return { label: `travel ${action.ms} ms`, moved: [] }
  },
  back: async (_action, context) => {
    await context.tabs.page.goBack({ timeout: context.timeout })

    return { label: "back", moved: [] }
  },
  switch_tab: async (action, context) => {
    context.tabs.switchTo(action.tab)

    return { label: `switch to tab ${action.tab}`, moved: [] }
  },
  dialog: async (action, context) => ({ label: await answered(action, context), moved: [] }),
  drag: dragged,
  wait: waited,
  click_at: async (action, context) => ({
    ...(await visionReplays.click_at(action, onScreen(context))),
    moved: [],
  }),
  type_at: async (action, context) => ({
    ...(await visionReplays.type_at(action, onScreen(context))),
    moved: [],
  }),
  drag_at: async (action, context) => ({
    ...(await visionReplays.drag_at(action, onScreen(context))),
    moved: [],
  }),
  scroll_at: async (action, context) => ({
    ...(await visionReplays.scroll_at(action, onScreen(context))),
    moved: [],
  }),
}

/** What replaying an action taken on a screenshot needs; it may search for moved places when relocating. */
function onScreen(context: ReplayContext): VisionReplayContext {
  return {
    tabs: context.tabs,
    timeout: Math.min(context.timeout, FIND_MS),
    relocate: context.find !== undefined,
    spots: context.spots,
    text: (input) => inputText(input, context),
  }
}

function onPage(action: RecordedAction, context: ReplayContext): Promise<Replayed> {
  return onPageAs(action.kind, action, context)
}

/** Runs the page action for `kind`; a kind with none cannot be replayed on the page. */
function onPageAs<Kind extends RecordedAction["kind"]>(
  kind: Kind,
  action: ActionOf<Kind>,
  context: ReplayContext,
): Promise<Replayed> {
  const run: OnPage<Kind> | undefined = pageActions[kind]

  if (run === undefined) throw new Error(`cannot replay ${kind} on the page`)

  return run(action, context)
}

async function replayAction(action: RecordedAction, context: ReplayContext): Promise<Replayed> {
  const aimed = await operationOf(action, context)

  return aimed === undefined ? onPage(action, context) : onElement(action, aimed, context)
}

/** Waits for the browser to reach `route`; resolves with where it was when time ran out. */
async function reachRoute(context: ReplayContext, route: string): Promise<string | undefined> {
  const origin = new URL(context.appUrl).origin
  const deadline = Date.now() + context.timeout
  let at = routeOf(context.tabs.page.url(), origin)

  while (at !== route && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, ROUTE_POLL_MS))
    at = routeOf(context.tabs.page.url(), origin)
  }

  return at === route ? undefined : at
}

/** How a replay went: the trace with any targets that were found somewhere else. */
export interface ReplayOutcome {
  /** The recording with moved targets updated; the same object when nothing moved. */
  readonly trace: Trace
  /** Targets found somewhere other than recorded, in action order. */
  readonly moved: readonly { readonly action: number; readonly from: Target; readonly to: Target }[]
  /** Places on the screen found somewhere other than recorded, described, in action order. */
  readonly movedPlaces: readonly {
    readonly action: number
    readonly from: string
    readonly to: string
  }[]
}

/** What replaying every action came to: moved targets, moved places, and revised actions. */
interface Replays {
  readonly moved: ReplayOutcome["moved"]
  readonly movedPlaces: ReplayOutcome["movedPlaces"]
  readonly revised: ReadonlyMap<number, RecordedAction>
}

/** The recording with each moved target replaced by where it was found. */
function retarget(trace: Trace, replays: Replays): Trace {
  const { moved, revised } = replays

  if (moved.length === 0 && revised.size === 0) return trace

  const actions = trace.actions.map((original, index) => {
    const action = revised.get(index) ?? original
    let updated: RecordedAction = action

    for (const move of moved.filter((entry) => entry.action === index)) {
      if ("target" in updated && updated.target === move.from)
        updated = { ...updated, target: move.to } as RecordedAction
      else if (updated.kind === "drag" && updated.to === move.from)
        updated = { ...updated, to: move.to }
    }

    return updated
  })

  return { ...trace, actions }
}

/** A dialog the action opened must be answered by the next recorded action. */
function checkDialog(done: Replayed, next: RecordedAction | undefined): void {
  const dialog = done.after?.dialog

  if (dialog !== undefined && next?.kind !== "dialog")
    throw new Error(`a ${dialog.type} dialog opened that the recording did not answer`)
}

async function replayStep(trace: Trace, index: number, context: ReplayContext): Promise<Replayed> {
  const action = trace.actions[index]

  if (action === undefined) throw new Error(`no action ${index}`)

  try {
    const done = await replayAction(action, context)

    context.onAction(done.label)
    checkDialog(done, trace.actions[index + 1])
    if (done.after?.dialog === undefined) await context.ready()

    return done
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message.split("\n")[0] : String(cause)

    throw new ReplayMismatch(index, `action ${index + 1} (${action.kind}): ${reason}`)
  }
}

async function replayAll(trace: Trace, context: ReplayContext): Promise<Replays> {
  const moved: { action: number; from: Target; to: Target }[] = []
  const movedPlaces: { action: number; from: string; to: string }[] = []
  const revised = new Map<number, RecordedAction>()

  for (let index = 0; index < trace.actions.length; index++) {
    const done = await replayStep(trace, index, context)

    moved.push(...done.moved.map((move) => ({ action: index, ...move })))
    movedPlaces.push(...(done.movedPlaces ?? []).map((move) => ({ action: index, ...move })))
    if (done.revised !== undefined) revised.set(index, done.revised)
  }

  return { moved, movedPlaces, revised }
}

/** Replays `trace`; throws ReplayMismatch at the first action or end route that no longer matches. */
export async function replay(trace: Trace, context: ReplayContext): Promise<ReplayOutcome> {
  const replays = await context.tabs.holdingDialogs(() => replayAll(trace, context))
  const at = await reachRoute(context, trace.endRoute)

  if (at !== undefined)
    throw new ReplayMismatch(trace.actions.length, `ended on ${at}, not ${trace.endRoute}`)

  return { trace: retarget(trace, replays), moved: replays.moved, movedPlaces: replays.movedPlaces }
}
