/**
 * A device screen as the agent reads it: one line per element, indented by nesting, each with a
 * ref to act on (`- button "Pay" [ref=e4]`), in the same shape as a page's snapshot. The driver's
 * own handles change with every reading, so refs here are the session's: an element keeps its ref
 * from one reading to the next while its role, name and id stay the same, and the driver's handle
 * behind it is looked up again before each action.
 */
import type { DeviceBox, DeviceNode } from "@danwo/runner/runner"

/** How far an element may shift, in screenshot pixels, and still be where the agent saw it. */
const MOVE_TOLERANCE = 4

/** What an element is, apart from where it is and what a field holds. */
export function identity(node: DeviceNode): string {
  return [node.role, node.name, node.testId ?? "", node.editable ? "" : node.text].join("|")
}

/** The elements of a reading worth a line: all but unnamed containers. */
function shown(node: DeviceNode): boolean {
  return !(node.role === "generic" && node.name === "" && node.testId === undefined)
}

function quoted(text: string): string {
  return JSON.stringify(text)
}

/** What a field holds, as its line shows it: never a password field's value. */
function valueText(node: DeviceNode): string {
  if (!node.editable || node.password) return ""

  return node.value === undefined || node.value === "" ? "" : `: ${quoted(node.value)}`
}

/** A field's hint, while it shows. */
function placeholderFlag(node: DeviceNode): string[] {
  const hint = node.placeholder ?? ""

  return hint === "" || (node.value ?? "") !== "" ? [] : [`[placeholder=${quoted(hint)}]`]
}

/** What else the line says about an element: its id, hint and state. */
function flagsOf(node: DeviceNode): string[] {
  const checked = node.checked === undefined ? [] : [node.checked ? "[checked]" : "[unchecked]"]

  return [
    ...(node.testId === undefined ? [] : [`[testId=${node.testId}]`]),
    ...placeholderFlag(node),
    ...(node.password ? ["[password]"] : []),
    ...(node.enabled ? [] : ["[disabled]"]),
    ...checked,
  ]
}

/** One element's line, without its indent. */
function lineOf(node: DeviceNode, ref: string): string {
  const name = node.name || (node.editable ? "" : node.text)

  return [
    `- ${node.role}${name === "" ? "" : ` ${quoted(name)}`}${valueText(node)}`,
    ...flagsOf(node),
    `[ref=${ref}]`,
  ].join(" ")
}

function sameBox(a: DeviceBox | undefined, b: DeviceBox | undefined): boolean {
  if (a === undefined || b === undefined) return a === b

  return (
    Math.abs(a.x - b.x) <= MOVE_TOLERANCE &&
    Math.abs(a.y - b.y) <= MOVE_TOLERANCE &&
    Math.abs(a.width - b.width) <= MOVE_TOLERANCE &&
    Math.abs(a.height - b.height) <= MOVE_TOLERANCE
  )
}

/** Where a box is, for an answer. */
export function boxText(box: DeviceBox | undefined): string {
  return box === undefined
    ? "no place on screen"
    : `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}`
}

/** One reading with the session's refs. */
export interface RefReading {
  readonly nodes: readonly DeviceNode[]
  /** The element each session ref names. */
  readonly byRef: ReadonlyMap<string, DeviceNode>
  /** Each element's session ref, by the driver's handle. */
  readonly refOf: ReadonlyMap<string, string>
}

/** Whether a session ref still names what the agent saw: where it was, moved, or gone. */
export type RefCheck =
  | { readonly kind: "same"; readonly node: DeviceNode }
  | { readonly kind: "moved"; readonly node: DeviceNode; readonly was: DeviceNode }
  | { readonly kind: "gone"; readonly was: DeviceNode }

/** The session's refs across readings. */
export class RefBook {
  private next = 1
  /** Each element's ref in the latest reading, by its identity and how many came before it. */
  private keys = new Map<string, string>()
  private latest: RefReading = { nodes: [], byRef: new Map(), refOf: new Map() }
  /** What the agent was last shown, by ref. */
  private seen = new Map<string, DeviceNode>()

  /** Gives `nodes` their refs: an element the latest reading had keeps its ref. */
  assign(nodes: readonly DeviceNode[]): RefReading {
    const counts = new Map<string, number>()
    const keys = new Map<string, string>()
    const byRef = new Map<string, DeviceNode>()
    const refOf = new Map<string, string>()

    for (const node of nodes) {
      const id = identity(node)
      const nth = counts.get(id) ?? 0
      const key = `${id}#${nth}`
      const ref = this.keys.get(key) ?? `e${this.next++}`

      counts.set(id, nth + 1)
      keys.set(key, ref)
      byRef.set(ref, node)
      refOf.set(node.ref, ref)
    }

    this.keys = keys
    this.latest = { nodes, byRef, refOf }

    return this.latest
  }

  /** How `ref`, as the agent last saw it, stands in `reading`. */
  check(ref: string, reading: RefReading): RefCheck | undefined {
    const was = this.seen.get(ref)

    if (was === undefined) return undefined

    const node = reading.byRef.get(ref)

    if (node === undefined) return { kind: "gone", was }

    return sameBox(node.box, was.box) ? { kind: "same", node } : { kind: "moved", node, was }
  }

  /** The reading as lines, and what the agent now holds refs to. */
  render(reading: RefReading): string {
    const depth = new Map<string, number>()
    const lines: string[] = []

    this.seen = new Map()

    for (const node of reading.nodes) {
      const parent = node.parent === undefined ? undefined : depth.get(node.parent)
      const level = parent ?? -1
      const ref = reading.refOf.get(node.ref)

      if (!shown(node) || ref === undefined) {
        depth.set(node.ref, level)
        continue
      }

      depth.set(node.ref, level + 1)
      this.seen.set(ref, node)
      lines.push(`${"  ".repeat(level + 1)}${lineOf(node, ref)}`)
    }

    return lines.length === 0 ? "(nothing on screen)" : lines.join("\n")
  }
}
