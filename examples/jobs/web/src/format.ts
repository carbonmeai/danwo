/** How the page writes times, money and statuses. */

const WHEN = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })

/** `2026-10-22T09:00:00Z` as `Oct 22, 2026, 9:00 AM`, in the reader's time zone. */
export function when(iso: string | null): string {
  return iso === null ? "Not scheduled" : WHEN.format(new Date(iso))
}

const CLOCK = new Intl.DateTimeFormat("en", { timeStyle: "medium" })

/** `2026-10-22T09:01:02Z` as `9:01:02 AM`, for a line of the run history. */
export function clock(iso: string): string {
  return CLOCK.format(new Date(iso))
}

/** `6` cents as `$0.06`. */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** `2026-10-22T09:00`, the value a `datetime-local` field holds, for a date in local time. */
export function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Tomorrow at 09:00, local time: when a new digest goes out unless told otherwise. */
export function tomorrowAtNine(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0)
}

/** The badge a status wears: its kit class and its label. */
const BADGES: Readonly<Record<string, readonly [string, string]>> = {
  draft: ["badge", "Draft"],
  scheduled: ["badge badge-info", "Scheduled"],
  sending: ["badge badge-warning", "Sending"],
  sent: ["badge badge-success", "Sent"],
  "sent with failures": ["badge badge-danger", "Sent with failures"],
  queued: ["badge badge-warning", "Queued"],
  failed: ["badge badge-danger", "Failed"],
  completed: ["badge badge-success", "Completed"],
  retried: ["badge badge-warning", "Retried"],
}

export function badgeOf(status: string | null): readonly [string, string] {
  return BADGES[status ?? "draft"] ?? ["badge", status ?? ""]
}
