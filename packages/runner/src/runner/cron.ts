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

/** The range one field's values come from, and the names its values may go by. */
interface Range {
  readonly min: number
  readonly max: number
  readonly names: readonly string[]
}

/** The five fields' ranges, in order; a weekday of 7 is Sunday again. */
const RANGES: readonly Range[] = [
  { min: 0, max: 59, names: [] },
  { min: 0, max: 23, names: [] },
  { min: 1, max: 31, names: [] },
  { min: 1, max: 12, names: MONTHS },
  { min: 0, max: 7, names: WEEKDAYS },
]

/** A part's step: 1 without `/n`, undefined when `n` is not a whole number from 1. */
function stepOf(text: string | undefined): number | undefined {
  const step = text === undefined ? 1 : Number(text)

  return Number.isInteger(step) && step >= 1 ? step : undefined
}

/**
 * The first and last value of a part's range (`*`, `5`, `1-5`); with a step and no end (`5/15`)
 * it runs to the end of the field. Undefined when it is not a range in `range`.
 */
function boundsOf(
  text: string,
  stepped: boolean,
  range: Range,
): readonly [number, number] | undefined {
  if (text === "*") return [range.min, range.max]

  const [lowText = "", highText] = text.split("-")
  const low = valueOf(lowText, range.names, range.min)
  let high = stepped ? range.max : low

  if (highText !== undefined) high = valueOf(highText, range.names, range.min)
  if (low === undefined || high === undefined) return undefined

  return low >= range.min && high <= range.max && low <= high ? [low, high] : undefined
}

/** The values one comma-separated part (`*`, `5`, `1-5`, `*\/15`, `1-30/2`) allows. */
function partValues(part: string, range: Range): number[] | undefined {
  const [text = "", stepText] = part.split("/")
  const step = stepOf(stepText)
  const bounds = step === undefined ? undefined : boundsOf(text, stepText !== undefined, range)

  if (step === undefined || bounds === undefined) return undefined

  const [low, high] = bounds

  return Array.from({ length: Math.floor((high - low) / step) + 1 }, (_, n) => low + n * step)
}

/** One field, or undefined when it is not one. */
function fieldOf(text: string, range: Range): Field | undefined {
  const values = new Set<number>()

  for (const part of text.split(",")) {
    const allowed = partValues(part, range)

    if (allowed === undefined) return undefined
    for (const value of allowed) values.add(value)
  }

  return { values, any: text === "*" }
}

/** The five fields of `texts`, or undefined unless there are five and each is one. */
function fiveFields(
  texts: readonly string[],
): readonly [Field, Field, Field, Field, Field] | undefined {
  const fields = texts.flatMap((text, n) => {
    const range = RANGES[n]
    const field = range && fieldOf(text, range)

    return field ? [field] : []
  })
  const [minute, hour, day, month, weekday] = fields

  if (texts.length !== 5 || !minute || !hour || !day || !month || !weekday) return undefined

  return [minute, hour, day, month, weekday]
}

/** A schedule, or undefined when `expression` is not one this reads. */
function parseCron(expression: string): Schedule | undefined {
  const zoned = /^(?:CRON_)?TZ=(\S+)\s+(.*)$/.exec(expression.trim())
  const rest = (zoned?.[2] ?? expression).trim()
  const fields = fiveFields((SHORTHANDS[rest] ?? rest).split(/\s+/))

  if (fields === undefined) return undefined

  const [minute, hour, day, month, weekday] = fields

  /* Sunday is 0 or 7. */
  const weekdays = new Set([...weekday.values].map((value) => value % 7))

  return { minute, hour, day, month, weekday: { ...weekday, values: weekdays }, zone: zoned?.[1] }
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
