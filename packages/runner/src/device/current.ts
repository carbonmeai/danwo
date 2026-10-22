/**
 * An element found again on the latest screen just before it is pressed. A reading's refs are the
 * driver's handles only until the screen is read again, and the element may have moved since it
 * was found: the keyboard slid the form up, a list recycled its rows, a tab bar was rebuilt. So the
 * screen is read again, the element is found by what it is (its role, test id and name, the one
 * nearest where it was when several are alike), and it is pressed only once two readings agree on
 * where it is. An action also waits for the element to be enabled, as a person waits for a greyed
 * out button.
 */
import type { DeviceBox, DeviceNode, DeviceTarget } from "./types.ts"

const POLL_MS = 150
/** How far, in pixels, an edge may shift between readings and still count as in place. */
const STILL_PX = 1

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** What finding an element again came to: the element in the latest reading, or why not. */
export type Current =
  | { readonly node: DeviceNode }
  /** Gone from the screen, still disabled when time ran out, or still moving when it did. */
  | { readonly problem: "gone" | "disabled" | "moving" }

/** Whether two readings' nodes are the same element: the same role, test id, and name or hint. */
function sameElement(a: DeviceNode, b: DeviceNode): boolean {
  if (a.role !== b.role || a.testId !== b.testId) return false

  /* A field's name can follow what is typed into it; its hint stays. */
  return a.editable ? a.placeholder === b.placeholder : a.name === b.name
}

function middle(box: DeviceBox): readonly [number, number] {
  return [box.x + box.width / 2, box.y + box.height / 2]
}

/** How far apart two elements' middles are; the same ref counts as no distance without boxes. */
function distance(a: DeviceNode, b: DeviceNode): number {
  if (a.box === undefined || b.box === undefined) return a.ref === b.ref ? 0 : 1

  const [ax, ay] = middle(a.box)
  const [bx, by] = middle(b.box)

  return Math.hypot(ax - bx, ay - by)
}

/** The element in `nodes` that is `node` from an earlier reading; of several alike, the nearest. */
export function findAgain(nodes: readonly DeviceNode[], node: DeviceNode): DeviceNode | undefined {
  const alike = nodes.filter((each) => sameElement(each, node))

  return alike.toSorted((a, b) => distance(a, node) - distance(b, node))[0]
}

/** Whether two boxes are in the same place; elements with no box count as in place. */
function inPlace(a: DeviceBox | undefined, b: DeviceBox | undefined): boolean {
  if (a === undefined || b === undefined) return a === b

  return (
    Math.abs(a.x - b.x) <= STILL_PX &&
    Math.abs(a.y - b.y) <= STILL_PX &&
    Math.abs(a.width - b.width) <= STILL_PX &&
    Math.abs(a.height - b.height) <= STILL_PX
  )
}

/**
 * `node` on the screen as it is now, ready to press: found again in a new reading, where it was in
 * the reading before, and enabled when `enabled` asks for it. A moving or disabled element is read
 * again until it settles, up to `timeout`; one that is gone is reported at once.
 */
export async function currentNode(
  target: DeviceTarget,
  node: DeviceNode,
  options: { readonly timeout: number; readonly enabled: boolean },
): Promise<Current> {
  const deadline = Date.now() + options.timeout
  let where = node

  for (;;) {
    const now = findAgain((await target.read()).nodes, where)

    if (now === undefined) return { problem: "gone" }

    const settled = inPlace(now.box, where.box)

    if (settled && (now.enabled || !options.enabled)) return { node: now }
    if (Date.now() >= deadline) return { problem: settled ? "disabled" : "moving" }

    where = now
    await sleep(POLL_MS)
  }
}

/** Why an element could not be pressed, in words that follow its description. */
export function currentProblem(problem: Exclude<Current, { node: DeviceNode }>["problem"]): string {
  return PROBLEMS[problem]
}

const PROBLEMS: Readonly<Record<Exclude<Current, { node: DeviceNode }>["problem"], string>> = {
  gone: "is no longer on the screen",
  disabled: "is disabled",
  moving: "kept moving on the screen",
}
