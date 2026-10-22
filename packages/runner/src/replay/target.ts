/**
 * A recorded action's target, described the way a person would point at it (test id, role and
 * name, or exact text) so a replay finds the same element again on a fresh page. A replay matches
 * exactly: if the description no longer picks out one element, the recording no longer applies.
 * An element inside frames (a payment widget's iframe, from another origin or not) is described
 * within its frame, with the frames it sits in named by their `<iframe>` elements.
 */
import type { ElementHandle, Frame, FrameLocator, Locator, Page } from "playwright-core"

import { iconSelector } from "../snapshot/icons.ts"
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

/** Where a target's element is looked for: the page, or the frames it sits in. */
type Scope = Page | FrameLocator

/** The scope of `target` on `page`: the page, or its frames entered one after another. */
function scopeOf(page: Page, target: Target): Scope {
  let scope: Scope = page

  for (const selector of target.frame ?? []) scope = scope.frameLocator(selector)

  return scope
}

/** Every element `target` describes, before choosing among them. */
function candidates(page: Page, target: Target): Locator | undefined {
  const scope = scopeOf(page, target)

  if (target.testId !== undefined) return scope.getByTestId(target.testId)
  if (target.icon !== undefined) return scope.locator(iconSelector({ icon: target.icon }))

  if (target.role !== undefined && isRoleName(target.role)) {
    const byRole = scope.getByRole(target.role, {
      ...(target.name !== undefined && { name: target.name, exact: true }),
    })

    return target.name === undefined && target.text !== undefined
      ? byRole.filter({ hasText: exactText(target.text) })
      : byRole
  }

  if (target.text !== undefined) return scope.getByText(target.text, { exact: true })

  return undefined
}

/** What of an `<iframe>` element can name it; runs in the page. */
function frameAttributes(node: Element) {
  return {
    id: node.id,
    title: node.getAttribute("title"),
    name: node.getAttribute("name"),
    src: node.getAttribute("src"),
  }
}

/** Selectors that might name a frame's `<iframe>`, most telling first. */
function frameChoices(attributes: ReturnType<typeof frameAttributes>, base: string): string[] {
  const src = attributes.src === null ? null : URL.parse(attributes.src, base)

  return [
    attributes.id === "" ? undefined : `iframe[id=${JSON.stringify(attributes.id)}]`,
    attributes.title === null ? undefined : `iframe[title=${JSON.stringify(attributes.title)}]`,
    attributes.name === null ? undefined : `iframe[name=${JSON.stringify(attributes.name)}]`,
    src === null ? undefined : `iframe[src^=${JSON.stringify(`${src.origin}${src.pathname}`)}]`,
  ].filter((choice) => choice !== undefined)
}

/** A selector of the `<iframe>` element of `frame` that picks out only it in its parent document. */
async function frameSelector(frame: Frame): Promise<string | undefined> {
  const parent = frame.parentFrame()
  const element = await frame.frameElement().catch(() => undefined)

  if (parent === null || element === undefined) return undefined

  const attributes = await element.evaluate(frameAttributes)

  for (const choice of frameChoices(attributes, parent.url()))
    if ((await parent.locator(choice).count()) === 1) return choice

  return undefined
}

/**
 * The frames `element` sits in, outermost first, as selectors of their `<iframe>` elements; an
 * empty list on the page itself, undefined when a frame cannot be singled out.
 */
async function framesOf(element: ElementHandle): Promise<string[] | undefined> {
  const chain: string[] = []
  let frame = await element.ownerFrame()

  while (frame !== null && frame.parentFrame() !== null) {
    const selector = await frameSelector(frame)

    if (selector === undefined) return undefined
    chain.unshift(selector)
    frame = frame.parentFrame()
  }

  return chain
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
    line.name !== undefined
      ? { role: line.role, name: line.name }
      : line.text !== undefined
        ? { role: line.role, text: line.text }
        : { role: line.role, ...(line.icon !== undefined && { icon: line.icon }) }

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
  const { testId, frames } = await factsOf(element)

  if (frames === undefined) return undefined

  const base = baseTarget(refLine(tree, ref), testId, refSection(tree, ref))

  return singleOut(page, framed(base, frames), element)
}

/** The element's test id, and the frames it sits in (undefined when one cannot be singled out). */
async function factsOf(element: Locator) {
  const testId = await element.getAttribute("data-testid", { timeout: 1_000 }).catch(() => null)
  const handle = await element.elementHandle({ timeout: 1_000 }).catch(() => null)
  const frames = handle === null ? [] : await framesOf(handle)

  return { testId, frames }
}

function framed(target: Target, frames: readonly string[]): Target {
  return frames.length > 0 ? { ...target, frame: [...frames] } : target
}

/**
 * The elements like the one behind `ref`, to count them: those with its test id, or else every
 * element of its role. Undefined when neither describes them (an element with no test id and a
 * plain role, such as a `div`).
 */
export async function describeKind(
  page: Page,
  tree: string,
  ref: string,
): Promise<Target | undefined> {
  const { testId, frames } = await factsOf(page.getByRef(ref))
  const role = refLine(tree, ref)?.role

  if (frames === undefined) return undefined
  if (testId !== null) return framed({ testId }, frames)

  return role !== undefined && isRoleName(role) ? framed({ role }, frames) : undefined
}

/**
 * Every shown element `target` describes, once at least one is, waiting up to `timeout`; throws
 * TargetMissing when none comes. A count of none is not read: the elements may have been renamed.
 */
export async function findAll(page: Page, target: Target, timeout: number): Promise<Locator> {
  const matches = candidates(page, target)?.filter({ visible: true })

  if (matches === undefined) throw new TargetMissing(`${describe(target)} describes nothing`)

  const deadline = Date.now() + timeout

  while ((await matches.count()) === 0) {
    if (Date.now() >= deadline)
      throw new TargetMissing(`${describe(target)} is no longer on the page`)

    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  return matches
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
  const frames = (target.frame ?? []).map(
    (selector) => `frameLocator(${JSON.stringify(selector)}).`,
  )

  return `${frames.join("")}${describeIn(target)}`
}

/** The target as locator code within its frame. */
function describeIn(target: Target): string {
  const at = target.nth === undefined ? "" : `.nth(${target.nth})`

  return `${finderOf(target)}${at}`
}

/** The finder a target is described by, before its `nth`. */
function finderOf(target: Target): string {
  if (target.testId !== undefined) return `getByTestId(${JSON.stringify(target.testId)})`
  if (target.icon !== undefined) return `icon(${JSON.stringify(target.icon)})`

  if (target.role !== undefined && isRoleName(target.role)) {
    const name = target.name === undefined ? "" : `, name: ${JSON.stringify(target.name)}`
    const text =
      target.name === undefined && target.text !== undefined
        ? `, text: ${JSON.stringify(target.text)}`
        : ""

    return `getByRole(${JSON.stringify(target.role)}${name}${text})`
  }

  return `getByText(${JSON.stringify(target.text ?? "")})`
}
