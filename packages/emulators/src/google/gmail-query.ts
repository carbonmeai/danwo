import type { GmailLabelRecord, GmailMessageRecord } from "./entities.ts"
import { snippetOf } from "./gmail-format.ts"
import { addressesIn, bodyText, decodeWords, headerOf, leaves, parseMime } from "./mime.ts"

/**
 * The subset of Gmail's search syntax the emulator understands: `from:`, `to:`, `cc:`,
 * `subject:`, `label:`, `in:`, `is:` (unread, read, starred, important), `has:attachment`,
 * `filename:`, `after:` / `before:` (dates or seconds), `newer_than:` / `older_than:` (d, m, y),
 * negation with `-`, quoted phrases, and bare words matched against subject and body.
 */

/** One search term: an optional operator, its value and whether it is negated. */
interface Term {
  readonly negated: boolean
  readonly operator: string | undefined
  readonly value: string
}

const TERM = /(-?)(?:([a-z_]+):)?("([^"]*)"|\S+)/gi

function termsOf(q: string): Term[] {
  return [...q.matchAll(TERM)].map((match) => ({
    negated: match[1] === "-",
    operator: match[2]?.toLowerCase(),
    value: (match[4] ?? match[3] ?? "").replace(/^"|"$/g, "").toLowerCase(),
  }))
}

/** What a search term is checked against, read from a message once. */
interface Searchable {
  readonly message: GmailMessageRecord
  readonly header: (name: string) => string
  readonly text: string
  readonly filenames: readonly string[]
  readonly labelNames: ReadonlyMap<string, string>
}

function searchableOf(
  message: GmailMessageRecord,
  labels: readonly GmailLabelRecord[],
): Searchable {
  const mime = parseMime(message.raw)
  const header = (name: string) => decodeWords(headerOf(mime.headers, name) ?? "").toLowerCase()
  const text = `${header("subject")} ${snippetOf(mime)} ${bodyText(mime, "text/plain") ?? ""}`

  return {
    message,
    header,
    text: text.toLowerCase(),
    filenames: leaves(mime)
      .map((leaf) => leaf.filename.toLowerCase())
      .filter(Boolean),
    labelNames: new Map(labels.map((label) => [label.name.toLowerCase(), label.labelId])),
  }
}

/** Seconds since the epoch for `after:` and `before:` values (`2024/01/31` or seconds). */
function instantOf(value: string): number {
  return /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value.replaceAll("/", "-"))
}

const UNIT_MS: Readonly<Record<string, number>> = {
  d: 86_400_000,
  m: 30 * 86_400_000,
  y: 365 * 86_400_000,
}

function ageMs(value: string): number {
  const match = /^(\d+)([dmy])$/.exec(value)

  return match ? Number(match[1]) * (UNIT_MS[match[2] ?? "d"] ?? 0) : 0
}

const IS_LABELS: Readonly<Record<string, string>> = {
  unread: "UNREAD",
  starred: "STARRED",
  important: "IMPORTANT",
}

function hasLabel(item: Searchable, value: string): boolean {
  const id = item.labelNames.get(value) ?? value.toUpperCase()

  return item.message.labelIds.includes(id)
}

function isMatch(item: Searchable, value: string): boolean {
  if (value === "read") return !item.message.labelIds.includes("UNREAD")

  return item.message.labelIds.includes(IS_LABELS[value] ?? value.toUpperCase())
}

function addressMatch(item: Searchable, name: string, value: string): boolean {
  const header = item.header(name)

  return header.includes(value) || addressesIn(header).some((address) => address.includes(value))
}

type Check = (item: Searchable, value: string, now: number) => boolean

const OPERATORS: Readonly<Record<string, Check>> = {
  from: (item, value) => addressMatch(item, "from", value),
  to: (item, value) => addressMatch(item, "to", value),
  cc: (item, value) => addressMatch(item, "cc", value),
  subject: (item, value) => item.header("subject").includes(value),
  label: hasLabel,
  in: (item, value) => value === "anywhere" || hasLabel(item, value),
  is: isMatch,
  has: (item, value) => value === "attachment" && item.filenames.length > 0,
  filename: (item, value) => item.filenames.some((name) => name.includes(value)),
  after: (item, value) => item.message.internalDate > instantOf(value),
  before: (item, value) => item.message.internalDate < instantOf(value),
  newer_than: (item, value, now) => item.message.internalDate > now - ageMs(value),
  older_than: (item, value, now) => item.message.internalDate < now - ageMs(value),
}

function termMatches(item: Searchable, term: Term, now: number): boolean {
  const check = term.operator === undefined ? undefined : OPERATORS[term.operator]
  const matched = check ? check(item, term.value, now) : item.text.includes(term.value)

  return matched !== term.negated
}

/** The messages that match every term of `q`. An empty query matches everything. */
export function searchMessages(
  messages: readonly GmailMessageRecord[],
  q: string | undefined,
  labels: readonly GmailLabelRecord[],
  now: number,
): GmailMessageRecord[] {
  const terms = termsOf(q ?? "")

  if (terms.length === 0) return [...messages]

  return messages.filter((message) => {
    const item = searchableOf(message, labels)

    return terms.every((term) => termMatches(item, term, now))
  })
}
