/**
 * The device's screen as the agent reads it, in the same text a web page's view has: one line per
 * element, `- role "name" [state] [ref=e12]: value`, indented under the element that holds it, so
 * the actor, the judge and the effect watch read a device the way they read a page. Containers
 * with nothing to say are left out and their children move up; refs are the latest reading's.
 */
import { routeOf } from "../../replay/route.ts"
import { collapse, nameIn } from "../match.ts"
import type { DeviceForeground, DeviceNode, DeviceScreenReading } from "../types.ts"

/** What the agent sees of the device now. */
export interface DeviceView {
  /** Where the screen is: the app, or a browser and the page it shows. */
  readonly where: string
  /** The elements as lines, redacted. */
  readonly tree: string
  /** The reading the tree was made from; its refs are the ones actions take. */
  readonly nodes: readonly DeviceNode[]
}

/** Roles whose `checked` state is worth showing. */
const CHECKABLE = new Set(["checkbox", "switch", "radio"])

/** Whether a node says nothing a person would read or act on: an empty container. */
function silent(node: DeviceNode): boolean {
  return node.role === "generic" && node.name === "" && node.text === ""
}

/**
 * The bracketed states of a node, e.g. ` [disabled] [checked]`: a checkbox's either way, any other
 * element's checked or selected state only when it has it (the active tab is `[selected]`).
 */
function states(node: DeviceNode): string {
  const parts: string[] = []

  if (!node.enabled) parts.push("[disabled]")
  if (CHECKABLE.has(node.role)) parts.push(node.checked === true ? "[checked]" : "[checked=false]")
  else if (node.checked === true) parts.push("[checked]")
  if (node.selected === true) parts.push("[selected]")

  return parts.map((part) => ` ${part}`).join("")
}

/** A field's value after the colon; a password field never shows one. */
function valuePart(node: DeviceNode): string {
  if (!node.editable) return node.text !== "" && node.text !== node.name ? `: ${node.text}` : ""
  if (node.password) return node.value ? ": ••••" : ""

  const placeholder =
    !node.value && node.placeholder ? ` [placeholder=${JSON.stringify(node.placeholder)}]` : ""

  return `${placeholder}${node.value ? `: ${node.value}` : ""}`
}

/** One node's line, without its indentation, named `label`. */
function nodeLine(node: DeviceNode, label: string): string {
  const name = label === "" ? "" : ` ${JSON.stringify(label)}`

  return `- ${node.role}${name}${states(node)} [ref=${node.ref}]${valuePart(node)}`
}

/** The elements of `reading` as indented lines, empty containers left out. */
export function treeText(nodes: readonly DeviceNode[]): string {
  const depth = new Map<string, number>()
  const lines: string[] = []

  for (const node of nodes) {
    const above = node.parent === undefined ? -1 : (depth.get(node.parent) ?? -1)

    if (silent(node)) {
      depth.set(node.ref, above)
      continue
    }

    const level = above + 1

    depth.set(node.ref, level)
    /* A field is named by its label, as a person reads the form: the text beside it on a web page. */
    lines.push(
      `${"  ".repeat(level)}${nodeLine(node, node.editable ? collapse(nameIn(nodes, node)) : node.name)}`,
    )
  }

  return lines.join("\n")
}

/** Where the device is, in words: the app's package, or the browser and its page. */
function whereText(front: DeviceForeground): string {
  if (!front.browser) return `app ${front.package}`

  return `browser ${front.package}${front.url === undefined ? "" : ` at ${front.url}`}`
}

/** The view of one reading. */
export function deviceView(
  reading: DeviceScreenReading,
  front: DeviceForeground,
  redact: (text: string) => string,
): DeviceView {
  return {
    where: redact(whereText(front)),
    tree: redact(treeText(reading.nodes)),
    nodes: reading.nodes,
  }
}

/** The view as one block of text for a prompt. */
export function deviceViewText(view: DeviceView): string {
  return `Screen: ${view.where}\n\n${view.tree}`
}

/**
 * Where a step left the device, as a recording keeps it: `app` while the app is in front, else the
 * browser page's route, its generated ids as `:id`.
 */
export function deviceRoute(front: DeviceForeground): string {
  if (!front.browser) return "app"

  return front.url === undefined ? "browser" : routeOf(front.url, "")
}
