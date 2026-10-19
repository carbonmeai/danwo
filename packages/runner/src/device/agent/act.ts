/**
 * What the agent does on a device, the same whether the model chose the action or a recording
 * replays it: tap, type, pick, press, scroll, wait. Each waits for the app afterwards, as a
 * locator action does.
 */
import { DanwoError } from "../../support/codes.ts"
import { textMatches } from "../match.ts"
import type { DeviceNode, DeviceScreenReading, DeviceTarget, ScrollDirection } from "../types.ts"

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

export async function tapNode(context: ActContext, node: DeviceNode): Promise<void> {
  await context.target.tap(node.ref)
  await context.ready()
}

export async function fillNode(context: ActContext, node: DeviceNode, text: string): Promise<void> {
  if (!node.editable) throw new Error(`${node.role} "${node.name}" is not a text field`)

  await context.target.fill(node.ref, text)
  await context.ready()
}

/** Turns a checkbox or switch on or off, tapping only when it is not that way already. */
export async function checkNode(
  context: ActContext,
  node: DeviceNode,
  checked: boolean,
): Promise<void> {
  if ((node.checked === true) !== checked) await tapNode(context, node)
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
  if (node !== undefined) await context.target.tap(node.ref)

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

  await context.target.scroll(direction, node?.box)
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
