/**
 * What the agent does on a device, the same whether the model chose the action or a recording
 * replays it: tap, type, pick, press, hold, swipe, scroll, wait. An element is found again on the
 * latest screen before it is pressed, and waited for until it is enabled (see current.ts), as a
 * locator action does; each action waits for the app afterwards.
 */
import { DanwoError } from "../../support/codes.ts"
import { currentNode, currentProblem } from "../current.ts"
import { textMatches } from "../match.ts"
import type {
  DeviceNode,
  DeviceScreenReading,
  DeviceTarget,
  LongPressOptions,
  ScrollDirection,
} from "../types.ts"

const POLL_MS = 150

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** What every action works with. */
export interface ActContext {
  readonly target: DeviceTarget
  readonly timeout: number
  /** Waits for the app and the services behind it to settle. */
  readonly ready: () => Promise<void>
}

/** A gesture the device does not have, said plainly. */
function lacks(what: string): DanwoError {
  return new DanwoError("CONFIG_INVALID", `this device cannot ${what}`)
}

/** Reads the screen until `found` gives something, or `timeout` runs out. */
export async function readUntil<T>(
  target: DeviceTarget,
  timeout: number,
  found: (reading: DeviceScreenReading) => T | undefined,
): Promise<T | undefined> {
  const deadline = Date.now() + timeout

  for (;;) {
    const result = found(await target.read())

    if (result !== undefined || Date.now() >= deadline) return result

    await sleep(POLL_MS)
  }
}

/** Whether a node shows `text`: its text or its name, as `getByText` compares. */
function shows(node: DeviceNode, text: string): boolean {
  return [node.text, node.name].some((said) => said !== "" && textMatches(said, text, false))
}

/** How an element is named in an error: its role and name. */
function named(node: DeviceNode): string {
  return `${node.role} "${node.name || node.text}"`
}

/**
 * `node` as the latest reading has it: in place and, unless `enabled` is false, enabled. Its ref
 * is the one to press, whatever reading `node` came from.
 */
async function fresh(context: ActContext, node: DeviceNode, enabled = true): Promise<DeviceNode> {
  const found = await currentNode(context.target, node, { timeout: context.timeout, enabled })

  if ("node" in found) return found.node

  throw new Error(`${named(node)} ${currentProblem(found.problem)}`)
}

export async function tapNode(context: ActContext, node: DeviceNode): Promise<void> {
  await context.target.tap((await fresh(context, node)).ref)
  await context.ready()
}

export async function fillNode(context: ActContext, node: DeviceNode, text: string): Promise<void> {
  if (!node.editable) throw new Error(`${named(node)} is not a text field`)

  await context.target.fill((await fresh(context, node)).ref, text)
  await context.ready()
}

/** Turns a checkbox or switch on or off, tapping only when it is not that way already. */
export async function checkNode(
  context: ActContext,
  node: DeviceNode,
  checked: boolean,
): Promise<void> {
  const now = await fresh(context, node)

  if ((now.checked === true) !== checked) {
    await context.target.tap(now.ref)
    await context.ready()
  }
}

/** Presses `node` and holds it, for what opens a menu on a long press. */
export async function longPressNode(
  context: ActContext,
  node: DeviceNode,
  options: LongPressOptions = {},
): Promise<void> {
  if (context.target.longPress === undefined) throw lacks("long-press")

  await context.target.longPress((await fresh(context, node)).ref, options)
  await context.ready()
}

/**
 * Opens the picker `node` and taps the option with `option` as its text: a spinner's list or a
 * dropdown shows its options as elements once it is open.
 */
export async function selectOption(
  context: ActContext,
  node: DeviceNode,
  option: string,
): Promise<void> {
  await tapNode(context, node)

  const choice = await readUntil(context.target, context.timeout, (reading) =>
    reading.nodes.find(
      (each) => each.ref !== node.ref && textMatches(each.text || each.name, option, true),
    ),
  )

  if (choice === undefined) throw new Error(`the picker shows no option "${option}"`)

  await tapNode(context, choice)
}

/** Presses `key`, tapping `node` first so a field gets it. */
export async function pressKey(
  context: ActContext,
  key: string,
  node: DeviceNode | undefined,
): Promise<void> {
  if (context.target.pressKey === undefined) throw lacks("press keys")
  if (node !== undefined) await context.target.tap((await fresh(context, node)).ref)

  await context.target.pressKey(key)
  await context.ready()
}

/** Scrolls the screen, or the element `node`, to show more `direction`. */
export async function scrollTo(
  context: ActContext,
  direction: ScrollDirection,
  node: DeviceNode | undefined,
): Promise<void> {
  if (context.target.scroll === undefined) throw lacks("scroll")

  const box = node === undefined ? undefined : (await fresh(context, node, false)).box

  await context.target.scroll(direction, box)
  await context.ready()
}

/**
 * Swipes one finger `direction` across `node` (the whole screen without it), taking `durationMs`:
 * slowly, a carousel turns its page or a list pulls to refresh.
 */
export async function swipeOn(
  context: ActContext,
  direction: ScrollDirection,
  node: DeviceNode | undefined,
  durationMs: number | undefined,
): Promise<void> {
  if (context.target.swipe === undefined) throw lacks("swipe")

  const box = node === undefined ? undefined : (await fresh(context, node, false)).box

  await context.target.swipe({
    direction,
    ...(box !== undefined && { within: box }),
    ...(durationMs !== undefined && { durationMs }),
  })
  await context.ready()
}

/** Puts the on-screen keyboard away. */
export async function dismissKeyboard(context: ActContext): Promise<void> {
  if (context.target.dismissKeyboard === undefined) throw lacks("put the keyboard away")

  await context.target.dismissKeyboard()
  await context.ready()
}

export async function goBack(context: ActContext): Promise<void> {
  await context.target.back()
  await context.ready()
}

export async function openLink(context: ActContext, url: string): Promise<void> {
  await context.target.openLink(url)
  await context.ready()
}

/** Taps a point of the screen, in screen pixels. */
export async function tapPoint(context: ActContext, x: number, y: number): Promise<void> {
  if (context.target.tapAt === undefined) throw lacks("tap a point")

  await context.target.tapAt(x, y)
  await context.ready()
}

/** Taps a point, then types `text` into what took focus. */
export async function typeAtPoint(
  context: ActContext,
  point: { readonly x: number; readonly y: number },
  text: string,
): Promise<void> {
  if (context.target.tapAt === undefined || context.target.typeText === undefined)
    throw lacks("type at a point")

  await context.target.tapAt(point.x, point.y)
  await context.target.typeText(text)
  await context.ready()
}

/** Waits for text to show (or with `hidden`, to go), or a while. */
export async function waitForText(
  context: ActContext,
  wait: {
    readonly text?: string | undefined
    readonly hidden?: boolean
    readonly ms?: number | undefined
  },
): Promise<void> {
  const { text } = wait

  if (text === undefined) {
    await sleep(wait.ms ?? 0)

    return
  }

  const wanted = wait.hidden !== true
  const done = await readUntil(context.target, context.timeout, (reading) =>
    reading.nodes.some((node) => shows(node, text)) === wanted ? true : undefined,
  )

  if (done === undefined)
    throw new Error(`"${text}" did not ${wanted ? "show" : "go"} within ${context.timeout} ms`)
}
