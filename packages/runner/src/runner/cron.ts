/**
 * Cron schedules as Inngest takes them: five fields (minute, hour, day of the month, month, day of
 * the week) with `*`, lists, ranges, steps and month and day names, an optional `TZ=<zone>` in
 * front, and the `@hourly`-style shorthands. Time travel asks whether one falls due on the way.
 */

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** How far ahead `cronDue` looks; every schedule that can fire at all fires within a year or so. */
const HORIZON_MS = 366 * DAY

const SHORTHANDS: Readonly<Record<string, string>> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

/** The values one field allows, and whether it was `*` (which matters for the two day fields). */
interface Field {
  readonly values: ReadonlySet<number>
  readonly any: boolean
}

/** A parsed schedule. */
interface Schedule {
  readonly minute: Field
  readonly hour: Field
  readonly day: Field
  readonly month: Field
  readonly weekday: Field
  readonly zone: string | undefined
}

/** One number of a field, by digits or by name (`names[0]` standing for `offset`). */
function valueOf(text: string, names: readonly string[], offset: number): number | undefined {
  const named = names.indexOf(text.toLowerCase())

  if (named >= 0) return named + offset

  return /^\d+$/.test(text) ? Number(text) : undefined
}

/** The values `min`..`max` that one comma-separated part (`*`, `5`, `1-5`, `*\/15`, `1-30/2`) allows. */
function partValues(
  part: string,
  min: number,
  max: number,
  names: readonly string[],
): number[] | undefined {
  const [range = "", stepText] = part.split("/")
  const step = stepText === undefined ? 1 : Number(stepText)

  if (!Number.isInteger(step) || step < 1) return undefined

  const [lowText = "", highText] = range.split("-")
  const low = range === "*" ? min : valueOf(lowText, names, min)
  /* `5/15` runs from 5 to the end; a lone `5` is just 5. */
  let high = highText === undefined ? low : valueOf(highText, names, min)

  if (range === "*" || (highText === undefined && stepText !== undefined)) high = max

  if (low === undefined || high === undefined || low < min || high > max || low > high)
    return undefined

  return Array.from({ length: Math.floor((high - low) / step) + 1 }, (_, n) => low + n * step)
}

/** One field, or undefined when it is not one. */
function fieldOf(
  text: string,
  min: number,
  max: number,
  names: readonly string[] = [],
): Field | undefined {
  const values = new Set<number>()

  for (const part of text.split(",")) {
    const allowed = partValues(part, min, max, names)

    if (allowed === undefined) return undefined
    for (const value of allowed) values.add(value)
  }

  return { values, any: text === "*" }
}

/** A schedule, or undefined when `expression` is not one this reads. */
function parseCron(expression: string): Schedule | undefined {
  const zoned = /^(?:CRON_)?TZ=(\S+)\s+(.*)$/.exec(expression.trim())
  const zone = zoned?.[1]
  const rest = (zoned?.[2] ?? expression).trim()
  const fields = (SHORTHANDS[rest] ?? rest).split(/\s+/)

  if (fields.length !== 5) return undefined

  const [minute, hour, day, month, weekday] = [
    fieldOf(fields[0] ?? "", 0, 59),
    fieldOf(fields[1] ?? "", 0, 23),
    fieldOf(fields[2] ?? "", 1, 31),
    fieldOf(fields[3] ?? "", 1, 12, MONTHS),
    fieldOf(fields[4] ?? "", 0, 7, WEEKDAYS),
  ]

  if (!minute || !hour || !day || !month || !weekday) return undefined

  /* Sunday is 0 or 7. */
  const weekdays = new Set([...weekday.values].map((value) => value % 7))

  return { minute, hour, day, month, weekday: { ...weekday, values: weekdays }, zone }
}

/** A moment's wall-clock fields in `zone`, or in UTC without one. */
type WallClock = (ms: number) => readonly [number, number, number, number, number]

function wallClock(zone: string | undefined): WallClock {
  if (zone === undefined) {
    return (ms) => {
      const date = new Date(ms)

      return [
        date.getUTCMinutes(),
        date.getUTCHours(),
        date.getUTCDate(),
        date.getUTCMonth() + 1,
        date.getUTCDay(),
      ]
    }
  }

  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
  })

  return (ms) => {
    const parts = Object.fromEntries(
      format.formatToParts(ms).map((part) => [part.type, part.value]),
    )

    return [
      Number(parts.minute),
      Number(parts.hour),
      Number(parts.day),
      Number(parts.month),
      WEEKDAYS.indexOf(String(parts.weekday).toLowerCase()),
    ]
  }
}

/** Whether `schedule` fires at the minute with these wall-clock fields. */
function fires(schedule: Schedule, [minute, hour, day, month, weekday]: ReturnType<WallClock>) {
  if (!schedule.minute.values.has(minute) || !schedule.hour.values.has(hour)) return false
  if (!schedule.month.values.has(month)) return false

  const onDay = schedule.day.values.has(day)
  const onWeekday = schedule.weekday.values.has(weekday)

  /* With both day fields restricted, either one is enough, as in every cron. */
  if (!schedule.day.any && !schedule.weekday.any) return onDay || onWeekday

  return onDay && onWeekday
}

/**
 * Whether `expression` fires after `fromMs` and at or before `toMs`. An expression this cannot
 * read never fires; only the first year after `fromMs` is looked at.
 */
export function cronDue(expression: string, fromMs: number, toMs: number): boolean {
  const schedule = parseCron(expression)

  if (schedule === undefined) return false

  let clock: WallClock

  try {
    clock = wallClock(schedule.zone)
  } catch {
    return false
  }

  const until = Math.min(toMs, fromMs + HORIZON_MS)

  for (let at = Math.floor(fromMs / MINUTE) * MINUTE + MINUTE; at <= until; at += MINUTE)
    if (fires(schedule, clock(at))) return true

  return false
}
