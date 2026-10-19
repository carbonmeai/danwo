/**
 * The device driver's accessibility tree in the terms danwo's locators use: web roles (`button`,
 * `textbox`, `heading`…), the accessible name, the shown text, and React Native's `testID`. Status
 * and navigation bars and elements the user cannot see are left out.
 */
import type { DeviceNode } from "@danwo/runner/runner"

/** The fields of a driver node this mapping reads. */
export interface DriverNode {
  readonly index: number
  readonly ref?: string
  readonly type?: string
  readonly kind?: string
  readonly label?: string
  readonly value?: string
  readonly contentDescription?: string
  readonly identifier?: string
  readonly placeholder?: string
  readonly hintShowing?: boolean
  readonly enabled?: boolean
  readonly checked?: boolean
  readonly editable?: boolean
  readonly password?: boolean
  readonly heading?: boolean
  readonly hittable?: boolean
  readonly visibleToUser?: boolean
  readonly parentIndex?: number
  readonly systemBar?: string
  readonly rect?: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

/** Android widget classes by the role they play, checked in order. */
const ROLE_BY_CLASS: readonly (readonly [RegExp, string])[] = [
  /* A page in a browser or web view: its root, which is not a control even when tappable. */
  [/WebView$/, "document"],
  [/CheckBox$/, "checkbox"],
  [/Switch$|ToggleButton$/, "switch"],
  [/RadioButton$/, "radio"],
  [/Button$/, "button"],
  [/EditText$/, "textbox"],
  [/Image(View)?$/, "img"],
  [/TextView$/, "text"],
]

/** The node's role in web terms. */
export function roleOf(node: DriverNode): string {
  if (node.heading === true) return "heading"
  if (node.editable === true) return "textbox"

  const type = node.type ?? ""
  const byClass = ROLE_BY_CLASS.find(([pattern]) => pattern.test(type))

  return byClass === undefined ? roleByKind(node) : byClass[1]
}

/** The role of a node whose class says nothing: the driver's kind, or a React Native hint. */
function roleByKind(node: DriverNode): string {
  if (node.kind === "button" || node.kind === "link") return node.kind
  /* React Native's Pressable without a role: a tappable view group with a label. */
  if (node.hittable === true && (node.label ?? "") !== "") return "button"

  return node.kind === "text" ? "text" : "generic"
}

/** React Native's `testID`: Android's resource id without the package part. */
function testIdOf(identifier: string | undefined): string | undefined {
  if (identifier === undefined || identifier === "") return undefined

  const at = identifier.indexOf(":id/")

  return at === -1 ? identifier : identifier.slice(at + 4)
}

/** A field's value; an empty field showing its hint has the value "". */
function valueOf(node: DriverNode): string | undefined {
  if (node.editable !== true) return node.value

  /* Android reports the hint as the text of an empty field that shows it. */
  return node.hintShowing === true ? "" : (node.value ?? "")
}

/** The fields of a mapped node that only some elements have. */
function optionalFields(node: DriverNode, value: string | undefined, parent: string | undefined) {
  const testId = testIdOf(node.identifier)

  return {
    ...(value !== undefined && { value }),
    ...(testId !== undefined && { testId }),
    ...(node.placeholder !== undefined && { placeholder: node.placeholder }),
    ...(node.checked !== undefined && { checked: node.checked }),
    ...(parent !== undefined && { parent }),
    ...(node.rect !== undefined && {
      box: { x: node.rect.x, y: node.rect.y, width: node.rect.width, height: node.rect.height },
    }),
  }
}

function deviceNode(node: DriverNode, refs: ReadonlyMap<number, string>): DeviceNode {
  const editable = node.editable === true
  const value = valueOf(node)
  const name = node.label ?? node.contentDescription ?? ""
  const parent = node.parentIndex === undefined ? undefined : refs.get(node.parentIndex)

  return {
    ref: refOf(node),
    role: roleOf(node),
    name,
    text: editable ? (value ?? "") : name,
    editable,
    password: node.password === true,
    enabled: node.enabled !== false,
    ...optionalFields(node, value, parent),
  }
}

/** The driver's handle for `node`. */
function refOf(node: DriverNode): string {
  return node.ref ?? `e${node.index + 1}`
}

/** The elements a user sees, mapped for locators; bars and hidden elements left out. */
export function deviceNodes(nodes: readonly DriverNode[]): DeviceNode[] {
  const shown = nodes.filter((node) => node.systemBar === undefined && node.visibleToUser !== false)
  const refs = new Map(shown.map((node) => [node.index, refOf(node)]))

  return shown.map((node) => deviceNode(node, refs))
}
