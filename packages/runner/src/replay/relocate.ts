/**
 * Finding a recorded element that moved. When a target no longer picks out exactly one element,
 * the elements of the current view with the same role are scored by how much they look like it:
 * the name or text (most of the weight), the part of the page it sat in, and its test id. One
 * candidate is taken only when it scores well and clearly beats the next; otherwise the target is
 * reported missing as before. A replay that must follow its recording exactly never relocates.
 */
import type { Page } from "playwright-core"

import { viewElements, type ViewElement } from "../snapshot/view.ts"
import { describeTarget, findTarget, type Target } from "./target.ts"

/** The score a candidate needs, and how far ahead of the next it must be. */
const ACCEPT = 0.6
const MARGIN = 0.15

const WEIGHTS = { words: 0.6, section: 0.25, testId: 0.15 } as const

const SNAPSHOT_TIMEOUT_MS = 5_000

/** Pairs of letters in `text`, ignoring case and spacing, for comparing two names. */
function pairs(text: string): string[] {
  const plain = text.toLowerCase().replaceAll(/\s+/g, " ").trim()

  return Array.from({ length: Math.max(plain.length - 1, 0) }, (_, at) => plain.slice(at, at + 2))
}

/** How alike two names are, from 0 to 1: the share of letter pairs they have in common. */
export function likeness(a: string, b: string): number {
  if (a.toLowerCase().trim() === b.toLowerCase().trim()) return 1

  const left = pairs(a)
  const right = pairs(b)

  if (left.length === 0 || right.length === 0) return 0

  const pool = [...right]
  let shared = 0

  for (const pair of left) {
    const at = pool.indexOf(pair)

    if (at >= 0) {
      shared++
      pool.splice(at, 1)
    }
  }

  return (2 * shared) / (left.length + right.length)
}

type Clue = [weight: number, match: number]

/** How well the candidate's name or text matches the target's, when the target has one. */
function wordsClue(target: Target, candidate: ViewElement): Clue[] {
  const said = target.name ?? target.text
  const shown = candidate.name ?? candidate.text

  if (said === undefined) return []

  return [[WEIGHTS.words, shown === undefined ? 0 : likeness(said, shown)]]
}

/** Whether the candidate sits in the same part of the page and has the same test id. */
function placeClues(target: Target, candidate: ViewElement, testId: string | null): Clue[] {
  const clues: Clue[] = []

  if (target.section !== undefined)
    clues.push([WEIGHTS.section, target.section === candidate.section ? 1 : 0])
  if (target.testId !== undefined) clues.push([WEIGHTS.testId, target.testId === testId ? 1 : 0])

  return clues
}

/** A candidate's score against `target`, over the clues the target carries. */
function score(target: Target, candidate: ViewElement, testId: string | null): number {
  const clues = [...wordsClue(target, candidate), ...placeClues(target, candidate, testId)]
  const total = clues.reduce((sum, [weight]) => sum + weight, 0)

  return total === 0 ? 0 : clues.reduce((sum, [weight, match]) => sum + weight * match, 0) / total
}

/** Where a moved target is now: the element's ref in `tree`, or undefined when none is clear. */
async function bestCandidate(
  page: Page,
  tree: string,
  target: Target,
): Promise<string | undefined> {
  const sameRole = viewElements(tree).filter((element) => element.role === target.role)
  const scored: { ref: string; score: number }[] = []

  for (const candidate of sameRole) {
    const testId =
      target.testId === undefined
        ? null
        : await page
            .getByRef(candidate.ref)
            .getAttribute("data-testid", { timeout: 1_000 })
            .catch(() => null)

    scored.push({ ref: candidate.ref, score: score(target, candidate, testId) })
  }

  scored.sort((a, b) => b.score - a.score)

  const [best, next] = scored

  if (best === undefined || best.score < ACCEPT) return undefined
  if (next !== undefined && best.score - next.score < MARGIN) return undefined

  return best.ref
}

/** The element `target` moved to, with a description of it where it is now; undefined if unclear. */
async function relocate(
  page: Page,
  target: Target,
): Promise<{ element: ReturnType<Page["getByRef"]>; target: Target } | undefined> {
  if (target.role === undefined) return undefined

  const tree = await page.ariaSnapshot({ mode: "ai", timeout: SNAPSHOT_TIMEOUT_MS })
  const ref = await bestCandidate(page, tree, target)

  if (ref === undefined) return undefined

  const moved = await describeTarget(page, tree, ref)

  return moved === undefined ? undefined : { element: page.getByRef(ref), target: moved }
}

/**
 * Finds `target` on `page` exactly, and when that fails, where it moved; throws the exact
 * finder's error when it cannot tell.
 */
export async function findOrRelocate(page: Page, target: Target, timeout: number) {
  try {
    return { element: await findTarget(page, target, timeout), target }
  } catch (missing) {
    const moved = await relocate(page, target).catch(() => undefined)

    if (moved === undefined) throw missing

    return moved
  }
}
