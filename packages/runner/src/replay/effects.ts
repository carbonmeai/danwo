/**
 * What a step did, beyond running its actions: the elements it made appear or vanish on the page,
 * and what it made happen behind the page (the provider calls the app made through the proxy and
 * the webhooks delivered to it). A recording keeps its step's effects, and a replay has to have the
 * same ones: a replay whose clicks all ran while the save silently failed no longer passes.
 */
import { z } from "zod"

import { viewElements } from "../snapshot/view.ts"

export const effectsSchema = z.object({
  page: z.object({ appeared: z.array(z.string()), vanished: z.array(z.string()) }),
  /** Distinct provider calls (`POST api.stripe.com/v1/…`) and deliveries (`webhook …`), sorted. */
  backend: z.array(z.string()),
})

export type Effects = z.infer<typeof effectsSchema>

/** Elements kept per direction: a few telling ones, not the whole page. */
const MAX_PAGE_ELEMENTS = 10
/** The longest description kept; longer text is cut. */
const MAX_DESCRIPTION = 80

/** Roles listed first when a step changed many elements: the ones that say what happened. */
const TELLING_ROLES = [
  "alert",
  "status",
  "dialog",
  "alertdialog",
  "heading",
  "paragraph",
  "button",
  "link",
]

/** Text that changes from run to run on its own: clock times, dates, long numbers, ids. */
const VOLATILE = [
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  /\b\d{6,}\b/,
  /\b(?:just now|\d+\s*(?:s|sec|seconds?|m|min|minutes?|h|hours?|d|days?) ago)\b/i,
  /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/i,
  /\b[a-z]{2,8}_(?:test_|live_)?[A-Za-z0-9]{8,}\b/,
]

function clip(text: string): string {
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION)}…` : text
}

/** Each element of a page view as `role "name"`, or `role: text`, once per occurrence. */
export function pageDescriptions(tree: string): string[] {
  return viewElements(tree).flatMap((element) => {
    if (element.name !== undefined && element.name !== "")
      return [`${element.role} ${JSON.stringify(clip(element.name))}`]
    if (element.text !== undefined && element.text !== "")
      return [`${element.role}: ${clip(element.text)}`]

    return []
  })
}

/** What may not be recorded as an effect: run-to-run text and the step's own values. */
export interface EffectFilter {
  /** Values that differ between runs: the step's params, codes read from mail, secrets. */
  readonly values: readonly string[]
  /** Extra patterns of text to leave out, from the config. */
  readonly ignore: readonly RegExp[]
}

function kept(description: string, filter: EffectFilter): boolean {
  if (VOLATILE.some((pattern) => pattern.test(description))) return false
  if (filter.ignore.some((pattern) => pattern.test(description))) return false

  return !filter.values.some((value) => value.length >= 3 && description.includes(value))
}

function rank(description: string): number {
  const role = description.split(/[ :]/, 1)[0] ?? ""
  const at = TELLING_ROLES.indexOf(role)

  return at < 0 ? TELLING_ROLES.length : at
}

/** Descriptions in `from` more times than in `than`, each listed once, most telling first. */
function surplus(from: readonly string[], than: readonly string[], filter: EffectFilter) {
  const left = new Map<string, number>()

  for (const description of than) left.set(description, (left.get(description) ?? 0) + 1)

  const extra = new Set<string>()

  for (const description of from) {
    const count = left.get(description) ?? 0

    if (count > 0) left.set(description, count - 1)
    else if (kept(description, filter)) extra.add(description)
  }

  return [...extra].toSorted((a, b) => rank(a) - rank(b)).slice(0, MAX_PAGE_ELEMENTS)
}

/** The elements that appeared and vanished between two views of the page. */
export function pageEffect(
  before: readonly string[],
  after: readonly string[],
  filter: EffectFilter,
): Effects["page"] {
  return { appeared: surplus(after, before, filter), vanished: surplus(before, after, filter) }
}

/** Distinct signatures, sorted: order and repeats (retries, duplicates) do not count. */
export function backendEffect(signatures: readonly string[]): string[] {
  return [...new Set(signatures)].toSorted()
}

function listed(items: readonly string[]): string {
  return items.join(", ")
}

/** Why the page does not show the recorded effect; undefined when it does. */
export function pageMismatch(
  recorded: Effects["page"],
  now: readonly string[],
): string | undefined {
  const present = new Set(now)
  const missing = recorded.appeared.filter((description) => !present.has(description))
  const left = recorded.vanished.filter((description) => present.has(description))

  if (missing.length > 0) return `expected ${listed(missing)} on the page, saw none`
  if (left.length > 0) return `expected ${listed(left)} to be gone, still there`

  return undefined
}

/**
 * Why the backend did not do what the recording did; undefined when it did the same. An extra
 * webhook does not count: one the step before caused may only land now.
 */
export function backendMismatch(
  recorded: readonly string[],
  observed: readonly string[],
): string | undefined {
  const seen = new Set(observed)
  const expected = new Set(recorded)
  const missing = recorded.filter((signature) => !seen.has(signature))
  const extra = backendEffect(observed).filter(
    (signature) => !expected.has(signature) && !signature.startsWith("webhook "),
  )

  if (missing.length > 0) return `expected ${listed(missing)}, saw none`
  if (extra.length > 0) return `did not expect ${listed(extra)}`

  return undefined
}
