/**
 * Graph writes times as `{ dateTime, timeZone }` with a local wall-clock time and a zone that is
 * either a Windows name (`Pacific Standard Time`) or an IANA one (`America/Los_Angeles`). These
 * helpers turn them into instants and back. Windows names outside the table are read as UTC.
 */

/** Windows zone names as `Windows name = IANA name`, one per line. */
const WINDOWS_ZONE_LINES = `
UTC = UTC
Coordinated Universal Time = UTC
GMT Standard Time = Europe/London
Greenwich Standard Time = Atlantic/Reykjavik
W. Europe Standard Time = Europe/Berlin
Romance Standard Time = Europe/Paris
Central Europe Standard Time = Europe/Budapest
W. Central Africa Standard Time = Africa/Lagos
South Africa Standard Time = Africa/Johannesburg
E. Africa Standard Time = Africa/Nairobi
Eastern Standard Time = America/New_York
Central Standard Time = America/Chicago
Mountain Standard Time = America/Denver
Pacific Standard Time = America/Los_Angeles
India Standard Time = Asia/Kolkata
China Standard Time = Asia/Shanghai
Tokyo Standard Time = Asia/Tokyo
Singapore Standard Time = Asia/Singapore
AUS Eastern Standard Time = Australia/Sydney`

const WINDOWS_ZONES = new Map(
  WINDOWS_ZONE_LINES.trim()
    .split("\n")
    .flatMap((line) => {
      const [windows, iana] = line.split(" = ")

      return windows && iana ? [[windows, iana] as const] : []
    }),
)

/** The IANA zone for a Graph time zone name. */
function ianaZone(zone: string): string {
  const mapped = WINDOWS_ZONES.get(zone)

  if (mapped) return mapped

  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone
  } catch {
    return "UTC"
  }
}

/** The wall-clock fields of an instant in `zone`, as if it were UTC. */
function wallClock(instant: number, zone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ianaZone(zone),
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  )

  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
}

/** The instant a local `dateTime` in `zone` names, as an ISO string. */
export function toInstant(dateTime: string, zone: string): string {
  const local = Date.parse(`${dateTime.replace(/Z$/, "").slice(0, 23)}Z`)

  if (Number.isNaN(local)) throw new RangeError(`invalid dateTime ${dateTime}`)

  const firstGuess = local - (wallClock(local, zone) - local)
  const offset = wallClock(firstGuess, zone) - firstGuess

  return new Date(local - offset).toISOString()
}

/** An instant as Graph's local `dateTime` in `zone`: seven fractional digits, no offset. */
export function formatInZone(instant: string, zone: string): string {
  const wall = new Date(wallClock(Date.parse(instant), zone)).toISOString()

  return `${wall.slice(0, 19)}.0000000`
}
