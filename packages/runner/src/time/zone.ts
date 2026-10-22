/**
 * Reading a time a test names as the page's own wall clock. `time.set("2026-03-01T09:00")` means
 * 9 am where the page is: with the config's `timezoneId`, in that zone, not in the zone of the
 * machine the runner happens to run on. A time with an offset or a `Z` is the same instant
 * everywhere and is read as written.
 */

/** A date, or a date and time, with no offset: `2026-03-01` or `2026-03-01T09:00[:00[.000]]`. */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/

/** How far `zone`'s clock is ahead of UTC at the instant `at`, in milliseconds. */
function offsetAt(at: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((one) => one.type === type)?.value ?? 0)
  const wall = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  )

  return wall - (at - (((at % 1000) + 1000) % 1000))
}

/**
 * The instant `to` names. A wall-clock string with no offset is read in `zone` when one is given
 * (a date alone is midnight there); anything else is read as `Date` reads it.
 */
export function instantIn(to: Date | string | number, zone: string | undefined): number {
  if (typeof to !== "string" || zone === undefined || !WALL_CLOCK.test(to))
    return new Date(to).getTime()

  const asUtc = Date.parse(to.includes("T") ? `${to}Z` : `${to}T00:00Z`)
  const first = asUtc - offsetAt(asUtc, zone)
  /* Near a daylight-saving change the offset at the guess can differ from the one at the answer. */
  const second = asUtc - offsetAt(first, zone)

  return second
}
