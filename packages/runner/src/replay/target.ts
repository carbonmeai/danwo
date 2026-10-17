/**
 * A recorded action's target, described the way a person would point at it (test id, role and
 * name, or exact text) so a replay finds the same element again on a fresh page. A replay matches
 * exactly: if the description no longer picks out one element, the recording no longer applies.
 */
import type { Locator, Page } from "playwright-core"

import { type RefLine, refLine, refSection } from "../snapshot/view.ts"
import type { Target } from "./trace.ts"

export type { Target } from "./trace.ts"

/** Roles a description by role alone cannot single out, so they fall back to their text. */
const PLAIN_ROLES = new Set(["generic", "text", "paragraph", "group", "none", "presentation"])

type RoleName = Parameters<Page["getByRole"]>[0]

function isRoleName(role: string): role is RoleName {
  return !PLAIN_ROLES.has(role)
}

function exactText(text: string): RegExp {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`)
}

/** Every element `target` describes, before choosing among them. */
function candidates(page: Page, target: Target): Locator | undefined {
  if (target.testId !== undefined) return page.getByTestId(target.testId)

  if (target.role !== undefined && isRoleName(target.role)) {
    const byRole = page.getByRole(target.role, {
      ...(target.name !== undefined && { name: target.name, exact: true }),
    })

    return target.name === undefined && target.text !== undefined
      ? byRole.filter({ hasText: exactText(target.text) })
      : byRole
  }

  if (target.text !== undefined) return page.getByText(target.text, { exact: true })

  return undefined
}

/** Where in `matches` the element of `ref` sits, when there are several. */
async function ordinal(matches: Locator, ref: Locator): Promise<number | undefined> {
  const handle = await ref.elementHandle({ timeout: 1_000 })

  if (handle === null) return undefined

  const count = await matches.count()

  for (let i = 0; i < count; i++) {
    if (await matches.nth(i).evaluate((element, wanted) => element === wanted, handle)) return i
  }

  return undefined
}

/**
 * What a snapshot line and the element's test id say about it, before checking it is unique. A
 * test id is what finds it; role, name and section are kept too, to find it again if it moves.
 */
function baseTarget(line: RefLine | undefined, testId: string | null, section?: string): Target {
  const where = section === undefined ? {} : { section }
  const id = testId === null ? {} : { testId }

  if (line === undefined) return { ...id, ...where }

  const said =
    line.name === undefined
      ? { role: line.role, ...(line.text !== undefined && { text: line.text }) }
      : { role: line.role, name: line.name }

  return { ...id, ...said, ...where }
}

/** `base` if it picks out one element; else which of its matches `element` is; undefined if none. */
async function singleOut(page: Page, base: Target, element: Locator): Promise<Target | undefined> {
  const matches = candidates(page, base)
  const count = matches === undefined ? 0 : await matches.count()

  if (matches === undefined || count === 0) return undefined
  if (count === 1) return base

  const nth = await ordinal(matches, element)

  return nth === undefined ? undefined : { ...base, nth }
}

/**
 * Describes the element behind `ref` in the latest snapshot `tree`; undefined when nothing durable
 * picks it out (it then cannot be replayed).
 */
export async function describeTarget(
  page: Page,
  tree: string,
  ref: string,
): Promise<Target | undefined> {
  const element = page.getByRef(ref)
  const testId = await element.getAttribute("data-testid", { timeout: 1_000 }).catch(() => null)

  return singleOut(page, baseTarget(refLine(tree, ref), testId, refSection(tree, ref)), element)
}

/** Why a target could not be found again. */
class TargetMissing extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TargetMissing"
  }
}

const POLL_MS = 100

/** Finds the one element `target` describes, waiting up to `timeout`; throws TargetMissing. */
export async function findTarget(page: Page, target: Target, timeout: number): Promise<Locator> {
  const matches = candidates(page, target)

  if (matches === undefined) throw new TargetMissing(`${describe(target)} describes nothing`)

  const deadline = Date.now() + timeout
  let count = 0

  for (;;) {
    count = await matches.count()

    const wanted = target.nth === undefined ? count === 1 : count > target.nth

    if (wanted) return target.nth === undefined ? matches : matches.nth(target.nth)
    if (Date.now() >= deadline) break

    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  throw new TargetMissing(
    count === 0
      ? `${describe(target)} is no longer on the page`
      : `${describe(target)} matches ${count} elements`,
  )
}

/** The elements `target` describes, without waiting for them; for waits on an element to go away. */
export function locatorFor(page: Page, target: Target): Locator {
  const matches = candidates(page, target)

  if (matches === undefined) throw new TargetMissing(`${describe(target)} describes nothing`)

  return target.nth === undefined ? matches : matches.nth(target.nth)
}

/** The target as locator code, for records and messages: `getByRole("button", name: "Save")`. */
export function describe(target: Target): string {
  const at = target.nth === undefined ? "" : `.nth(${target.nth})`

  if (target.testId !== undefined) return `getByTestId(${JSON.stringify(target.testId)})${at}`

  if (target.role !== undefined && isRoleName(target.role)) {
    const name = target.name === undefined ? "" : `, name: ${JSON.stringify(target.name)}`
    const text =
      target.name === undefined && target.text !== undefined
        ? `, text: ${JSON.stringify(target.text)}`
        : ""

    return `getByRole(${JSON.stringify(target.role)}${name}${text})${at}`
  }

  return `getByText(${JSON.stringify(target.text ?? "")})${at}`
}
