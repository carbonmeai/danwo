/**
 * Jetpack Compose's controls, read as one element each. Compose reports a `Button` (or a
 * `Checkbox`, a `Switch`) as the tappable view that carries the modifiers (the test tag, the click),
 * with its label in a text child and the role in an empty child of the widget's class. Read as it
 * is, the button is an unnamed element inside a nameless group. Here the group takes the role and
 * the label, and the empty child goes, so `getByRole("button", { name })` finds it.
 */
import type { DriverNode } from "../tree.ts"

/** The widget classes Compose reports a control's role with, in an empty child. */
const ROLE_MARKERS = /^android\.widget\.(Button|CheckBox|Switch|RadioButton|ToggleButton)$/

/** Whether `node` is only a role marker: a widget class with no label and nothing inside it. */
function isMarker(node: DriverNode, parents: ReadonlySet<number>): boolean {
  return (
    ROLE_MARKERS.test(node.type ?? "") &&
    (node.label ?? "") === "" &&
    (node.contentDescription ?? "") === "" &&
    (node.identifier ?? "") === "" &&
    !parents.has(node.index)
  )
}

/** The label of a control whose text is in its children: their texts, in order. */
function childText(nodes: readonly DriverNode[], parent: DriverNode): string {
  return nodes
    .filter((node) => node.parentIndex === parent.index && node.type === "android.widget.TextView")
    .map((node) => node.label ?? "")
    .filter((text) => text !== "")
    .join(" ")
}

/** The tappable Compose view a role marker belongs to, or undefined when `node` is not a marker. */
function markedView(
  node: DriverNode,
  byIndex: ReadonlyMap<number, DriverNode>,
  parents: ReadonlySet<number>,
): DriverNode | undefined {
  if (!isMarker(node, parents) || node.parentIndex === undefined) return undefined

  const parent = byIndex.get(node.parentIndex)

  return parent?.type === "android.view.View" && parent.hittable === true ? parent : undefined
}

/** The control a marked view stands for: the marker's role and state, the view's label. */
function controlOf(view: DriverNode, marker: DriverNode, nodes: readonly DriverNode[]): DriverNode {
  const label = view.label ?? view.contentDescription ?? childText(nodes, view)

  return {
    ...view,
    type: marker.type ?? "",
    ...(label !== "" && { label }),
    ...(marker.checked !== undefined && { checked: marker.checked }),
  }
}

/** The Android tree with each Compose control read as one element; other trees as they are. */
export function composeNodes(nodes: readonly DriverNode[]): DriverNode[] {
  const byIndex = new Map(nodes.map((node) => [node.index, node]))
  const parents = new Set(nodes.flatMap((node) => node.parentIndex ?? []))
  const controls = new Map<number, DriverNode>()

  for (const node of nodes) {
    const view = markedView(node, byIndex, parents)

    if (view !== undefined) controls.set(node.index, controlOf(view, node, nodes))
  }

  if (controls.size === 0) return [...nodes]

  const promoted = new Map([...controls.values()].map((control) => [control.index, control]))

  return nodes
    .filter((node) => !controls.has(node.index))
    .map((node) => promoted.get(node.index) ?? node)
}
