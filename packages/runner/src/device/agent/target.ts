/**
 * Recorded targets on a device: how an element the agent acted on is described so a later run
 * finds it again, and how such a description is found. A target is the locator a person would
 * write (`getByTestId("buy")`, `getByRole("button", { name: "Pay" })`, `getByText("Done")`),
 * resolved with the device's own locator rules, so a recording and a test find elements alike.
 *
 * When a target no longer picks out one element (the button was renamed), and the replay may
 * relocate, the elements with the same role (or the same test id) are scored by how alike their
 * names are; one clear winner is taken, otherwise the target is missing.
 */
import { clearWinner, likeness } from "../../replay/relocate.ts"
import type { Target } from "../../replay/trace.ts"
import { type Chain, collapse, nameIn, resolveChain } from "../match.ts"
import type { DeviceNode } from "../types.ts"

/** The chain a target stands for. */
function chainOf(target: Target): Chain {
  const pick: Chain = target.nth === undefined ? [] : [{ pick: target.nth }]

  if (target.testId !== undefined)
    return [{ query: { by: "testId", match: target.testId } }, ...pick]
  if (target.role !== undefined && target.name !== undefined)
    return [
      { query: { by: "role", role: target.role, options: { name: target.name, exact: true } } },
      ...pick,
    ]

  return [{ query: { by: "text", match: target.text ?? "", exact: true } }, ...pick]
}

/** Ways to describe `node`, most durable first. */
function descriptions(nodes: readonly DeviceNode[], node: DeviceNode): Target[] {
  const name = collapse(nameIn(nodes, node))
  const text = collapse(node.text)
  const found: Target[] = []

  if (node.testId !== undefined) found.push({ testId: node.testId, role: node.role })
  if (name !== "") found.push({ role: node.role, name })
  if (!node.editable && text !== "") found.push({ role: node.role, text })

  return found
}

/**
 * How a later run finds `node` again: the first description that picks it out, with `nth` when
 * others match it too. Undefined when nothing describes it (an unnamed icon).
 */
export function describeNode(nodes: readonly DeviceNode[], node: DeviceNode): Target | undefined {
  for (const target of descriptions(nodes, node)) {
    const matched = resolveChain(nodes, chainOf(target))
    const at = matched.findIndex((each) => each.ref === node.ref)

    if (at < 0) continue

    return matched.length === 1 ? target : { ...target, nth: at }
  }

  return undefined
}

/** What finding a target in one reading came to. */
export type Finding =
  | { readonly node: DeviceNode; readonly moved?: Target }
  | { readonly missing: string }

/** How alike `node` is to `target`, from 0 to 1. */
function score(nodes: readonly DeviceNode[], target: Target, node: DeviceNode): number {
  const said = target.name ?? target.text
  const words = said === undefined ? 0 : likeness(said, nameIn(nodes, node) || node.text)
  const sameId = target.testId !== undefined && node.testId === target.testId

  return sameId ? Math.max(words, 0.8) : words
}

/** Where a target that matches nothing moved to, when one element clearly matches it. */
function relocate(nodes: readonly DeviceNode[], target: Target): Finding | undefined {
  const pool = nodes.filter(
    (node) =>
      node.role === target.role || (target.testId !== undefined && node.testId === target.testId),
  )
  const best = clearWinner(pool.map((node) => ({ node, score: score(nodes, target, node) })))

  if (best === undefined) return undefined

  const moved = describeNode(nodes, best.node)

  return moved === undefined ? undefined : { node: best.node, moved }
}

/**
 * The element `target` describes in `nodes`: exactly, else (when `relocating`) where it moved;
 * otherwise why it was not found.
 */
export function findNode(
  nodes: readonly DeviceNode[],
  target: Target,
  relocating: boolean,
): Finding {
  const matched = resolveChain(nodes, chainOf(target))
  const [only] = matched

  if (matched.length === 1 && only !== undefined) return { node: only }

  /* Several matches is not a move: the recording is ambiguous on this screen. */
  const moved = relocating && matched.length === 0 ? relocate(nodes, target) : undefined

  if (moved !== undefined) return moved

  return {
    missing: matched.length === 0 ? "matches nothing" : `matches ${matched.length} elements`,
  }
}
