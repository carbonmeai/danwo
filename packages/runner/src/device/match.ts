/**
 * Locators on a device screen: what a chain of `getBy…`, `filter` and `first()` calls matches in
 * one reading of the accessibility tree. Text matches the way web locators do: a string is a
 * case-insensitive substring unless `exact`, a RegExp tests.
 */
import type { RoleOptions, TextMatch } from "../locate/types.ts"
import type { DeviceNode } from "./types.ts"

/** What one `getBy…` call asks for. */
export type DeviceQuery =
  | { readonly by: "role"; readonly role: string; readonly options: RoleOptions }
  | {
      readonly by: "text" | "label" | "placeholder" | "value"
      readonly match: TextMatch
      readonly exact: boolean
    }
  | { readonly by: "testId"; readonly match: TextMatch }

/**
 * One link of a locator's chain: a query, a filter, a pick, or another chain whose elements are
 * added (`or`) or that the elements must also be among (`and`).
 */
export type ChainLink =
  | { readonly query: DeviceQuery }
  | DeviceFilter
  | { readonly pick: "first" | "last" | number }
  | { readonly join: "or" | "and"; readonly other: Chain }

export type Chain = readonly ChainLink[]

/** A filter link: texts the element's text must or must not hold, chains it must or must not hold. */
export interface DeviceFilter {
  readonly hasText?: TextMatch
  readonly hasNotText?: TextMatch
  readonly has?: Chain
  readonly hasNot?: Chain
}

/** Whitespace collapsed and trimmed, as text compares on screen. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** Whether `text` matches: a RegExp tests, a string is a case-insensitive substring unless `exact`. */
export function textMatches(text: string, match: TextMatch, exact: boolean): boolean {
  const seen = collapse(text)

  if (typeof match !== "string") return match.test(seen)

  return exact
    ? seen === collapse(match)
    : seen.toLowerCase().includes(collapse(match).toLowerCase())
}

/** The screen's elements by ref, with each one's children. */
class Tree {
  private readonly children = new Map<string, DeviceNode[]>()
  readonly nodes: readonly DeviceNode[]

  constructor(nodes: readonly DeviceNode[]) {
    this.nodes = nodes

    for (const node of nodes) {
      if (node.parent === undefined) continue

      const siblings = this.children.get(node.parent) ?? []

      siblings.push(node)
      this.children.set(node.parent, siblings)
    }
  }

  /** Every element inside `node`, nearest first. */
  descendants(node: DeviceNode): DeviceNode[] {
    const found: DeviceNode[] = []
    const queue = [...(this.children.get(node.ref) ?? [])]

    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      found.push(next)
      queue.push(...(this.children.get(next.ref) ?? []))
    }

    return found
  }

  /** The element just before `node` inside the same parent. */
  previousSibling(node: DeviceNode): DeviceNode | undefined {
    const siblings = node.parent === undefined ? [] : (this.children.get(node.parent) ?? [])
    const at = siblings.indexOf(node)

    return at > 0 ? siblings[at - 1] : undefined
  }

  /** The text of `node` and everything inside it, in reading order. */
  textWithin(node: DeviceNode): string {
    return [node, ...this.descendants(node)].map((each) => each.text).join(" ")
  }
}

/**
 * A field's label: its name when the name is not just its hint, else the text just before it in
 * the same group. A web page's `<label>Email <input></label>` reaches the tree as a text and an
 * unnamed field side by side.
 */
function labelOf(tree: Tree, node: DeviceNode): string {
  if (node.name !== "" && node.name !== node.placeholder) return node.name

  const before = tree.previousSibling(node)

  return before?.role === "text" ? before.text : ""
}

/** The name a role query compares: a field's label, any other element's name. */
function nameOf(tree: Tree, node: DeviceNode): string {
  return node.editable ? labelOf(tree, node) : node.name
}

function roleMatches(tree: Tree, node: DeviceNode, role: string, options: RoleOptions): boolean {
  if (node.role !== role) return false

  const { name, exact } = options

  if (name !== undefined && !textMatches(nameOf(tree, node), name, exact === true)) return false
  if (options.checked !== undefined && node.checked !== options.checked) return false
  if (options.selected !== undefined && (node.selected === true) !== options.selected) return false

  return options.disabled === undefined || node.enabled === !options.disabled
}

/** The string a text query compares on `node`, or undefined when it has none to compare. */
function compared(
  tree: Tree,
  node: DeviceNode,
  by: "text" | "label" | "placeholder" | "value",
): string | undefined {
  switch (by) {
    case "text":
      return node.text === "" ? undefined : node.text
    case "label":
      return node.editable ? labelOf(tree, node) : undefined
    case "placeholder":
      return node.placeholder
  }

  return node.editable ? (node.value ?? "") : undefined
}

/** Whether `node` answers `query` on its own (scope and nesting aside). */
function answers(tree: Tree, node: DeviceNode, query: DeviceQuery): boolean {
  if (query.by === "role") return roleMatches(tree, node, query.role, query.options)
  if (query.by === "testId")
    return node.testId !== undefined && textMatches(node.testId, query.match, true)

  const text = compared(tree, node, query.by)

  return text !== undefined && textMatches(text, query.match, query.exact)
}

/**
 * The innermost of `matched`: a button and the text inside it both carry the same words, and the
 * text is what `getByText` means.
 */
function innermost(tree: Tree, matched: readonly DeviceNode[]): DeviceNode[] {
  const refs = new Set(matched.map((node) => node.ref))

  return matched.filter((node) => !tree.descendants(node).some((inner) => refs.has(inner.ref)))
}

function applyQuery(tree: Tree, scope: readonly DeviceNode[] | undefined, query: DeviceQuery) {
  const pool = scope === undefined ? tree.nodes : scope.flatMap((node) => tree.descendants(node))
  const matched = pool.filter((node) => answers(tree, node, query))

  return query.by === "text" ? innermost(tree, matched) : matched
}

function applyFilter(tree: Tree, current: readonly DeviceNode[], link: DeviceFilter): DeviceNode[] {
  return current.filter((node) => {
    const text = tree.textWithin(node)
    const holds = (chain: Chain) => run(tree, chain, [node]).length > 0

    if (link.hasText !== undefined && !textMatches(text, link.hasText, false)) return false
    if (link.hasNotText !== undefined && textMatches(text, link.hasNotText, false)) return false
    if (link.has !== undefined && !holds(link.has)) return false

    return link.hasNot === undefined || !holds(link.hasNot)
  })
}

function applyPick(current: readonly DeviceNode[], pick: "first" | "last" | number): DeviceNode[] {
  const node = pick === "first" ? current[0] : pick === "last" ? current.at(-1) : current.at(pick)

  return node === undefined ? [] : [node]
}

/** `current` with what `other` matches added (`or`), or kept to it (`and`), in screen order. */
function applyJoin(
  tree: Tree,
  current: readonly DeviceNode[],
  join: "or" | "and",
  other: Chain,
): DeviceNode[] {
  const theirs = new Set(run(tree, other, undefined))
  const ours = new Set(current)

  return tree.nodes.filter((node) =>
    join === "or" ? ours.has(node) || theirs.has(node) : ours.has(node) && theirs.has(node),
  )
}

/** What one link leaves of `current` (the whole screen before the first query). */
function applyLink(
  tree: Tree,
  current: readonly DeviceNode[] | undefined,
  link: ChainLink,
): DeviceNode[] {
  if ("query" in link) return applyQuery(tree, current, link.query)
  if ("pick" in link) return applyPick(current ?? tree.nodes, link.pick)
  if ("join" in link) return applyJoin(tree, current ?? tree.nodes, link.join, link.other)

  return applyFilter(tree, current ?? tree.nodes, link)
}

function run(tree: Tree, chain: Chain, start: readonly DeviceNode[] | undefined): DeviceNode[] {
  let current = start

  for (const link of chain) current = applyLink(tree, current, link)

  return [...(current ?? tree.nodes)]
}

/** How many elements of `nodes` each link of `chain` leaves, in order. */
export function chainCounts(nodes: readonly DeviceNode[], chain: Chain): number[] {
  const tree = new Tree(nodes)
  const counts: number[] = []
  let current: readonly DeviceNode[] | undefined

  for (const link of chain) {
    current = applyLink(tree, current, link)
    counts.push(current.length)
  }

  return counts
}

/** The elements of `nodes` that `chain` matches, in screen order. */
export function resolveChain(nodes: readonly DeviceNode[], chain: Chain): DeviceNode[] {
  return run(new Tree(nodes), chain, undefined)
}

/** The name a role query compares on `node` in this reading: a field's label, else its name. */
export function nameIn(nodes: readonly DeviceNode[], node: DeviceNode): string {
  return nameOf(new Tree(nodes), node)
}

/** The text of `node` and everything inside it, from one reading. */
export function textOf(nodes: readonly DeviceNode[], node: DeviceNode): string {
  return collapse(new Tree(nodes).textWithin(node))
}
