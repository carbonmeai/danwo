/**
 * An iOS Simulator's accessibility tree, made to read like Android's before it is mapped for
 * locators: rectangles from points to screenshot pixels, text entry marked editable (and an empty
 * field's placeholder not taken for its value), and React Native's doubled text elements (a text
 * view and the accessibility element inside it, with the same label) counted once.
 */
import type { DriverNode } from "../tree.ts"

/** The element types a person types into. */
const TEXT_ENTRY = new Set(["TextField", "SecureTextField", "SearchField", "TextView"])

/** Identifiers of a Safari view's or sign-in session's own controls. */
const BROWSER_PARTS = /^(BrowserView|TopBrowserBar|BottomBrowserToolbar|URL$)/

/** Whether `node` repeats its parent: the same type and label, nothing inside it, no id of its own. */
function repeatsParent(
  node: DriverNode,
  byIndex: ReadonlyMap<number, DriverNode>,
  parents: ReadonlySet<number>,
): boolean {
  const parent = node.parentIndex === undefined ? undefined : byIndex.get(node.parentIndex)

  return (
    parent !== undefined &&
    !parents.has(node.index) &&
    (node.identifier ?? "") === "" &&
    parent.type === node.type &&
    (parent.label ?? "") === (node.label ?? "")
  )
}

/** `node` with its rectangle in screenshot pixels and its text entry fields filled in. */
function normalised(node: DriverNode, scale: number): DriverNode {
  const editable = TEXT_ENTRY.has(node.type ?? "")
  /* An empty field reports its placeholder as its value. */
  const empty = editable && (node.value === undefined || node.value === node.placeholder)

  return {
    ...node,
    ...(editable && { editable: true, hintShowing: empty }),
    ...(node.type === "SecureTextField" && { password: true }),
    ...(node.rect !== undefined && {
      rect: {
        x: node.rect.x * scale,
        y: node.rect.y * scale,
        width: node.rect.width * scale,
        height: node.rect.height * scale,
      },
    }),
  }
}

/** The simulator's tree as the shared mapping expects it. */
export function iosNodes(nodes: readonly DriverNode[], scale: number): DriverNode[] {
  const byIndex = new Map(nodes.map((node) => [node.index, node]))
  const parents = new Set(nodes.flatMap((node) => node.parentIndex ?? []))

  return nodes
    .filter((node) => !repeatsParent(node, byIndex, parents))
    .map((node) => normalised(node, scale))
}

/** Whether the tree shows a browser over the app: a Safari view, or a sign-in session's page. */
export function browserShowing(nodes: readonly DriverNode[]): boolean {
  return nodes.some(
    (node) =>
      BROWSER_PARTS.test(node.identifier ?? "") ||
      (node.type === "Application" && node.label === "Safari"),
  )
}
