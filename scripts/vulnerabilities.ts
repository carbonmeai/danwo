/**
 * The decisions behind the dependency scan: which advisories `bun audit` found block a change, which
 * reviewed exceptions in `.github/vulnerability-allowlist.json` have expired, and the OSV-Scanner
 * config that skips the same exceptions. `scripts/audit.ts` runs them.
 */

/** The severities `bun audit` reports, lowest first. */
const SEVERITIES = ["low", "moderate", "high", "critical"] as const

type Severity = (typeof SEVERITIES)[number]

/** The lowest severity that fails the scan. */
const BLOCKING: Severity = "high"

/** One reviewed exception: an advisory accepted for one package until `reviewBy`. */
export interface AllowlistEntry {
  /** The advisory's GHSA id, such as `GHSA-c475-qrg2-pj4r`. */
  readonly id: string
  readonly package: string
  /** How the package is reached, from the workspace that pulls it in. */
  readonly path: string
  readonly severity: Severity
  /** Why it is accepted: what makes the vulnerable code unreachable, and why it cannot be bumped. */
  readonly reason: string
  /** The date, `YYYY-MM-DD`, after which the exception no longer applies until it is reviewed again. */
  readonly reviewBy: string
}

/** One advisory, as `bun audit --json` lists it under its package. */
interface Advisory {
  readonly url: string
  readonly title: string
  readonly severity: Severity
  readonly vulnerable_versions: string
}

/** `bun audit --json`: each vulnerable package's advisories. */
export type AuditReport = Readonly<Record<string, readonly Advisory[]>>

/** An advisory found in a package. */
export interface Finding {
  readonly id: string
  readonly package: string
  readonly severity: Severity
  readonly title: string
  readonly url: string
}

const ENTRY_FIELDS = ["id", "package", "path", "severity", "reason", "reviewBy"] as const

/** Whether `value` is one of the severities. */
function isSeverity(value: unknown): value is Severity {
  return SEVERITIES.some((severity) => severity === value)
}

/** What is wrong with one allowlist entry, if anything. */
function entryProblem(entry: unknown, index: number): string | undefined {
  const missing = ENTRY_FIELDS.filter((field) => {
    const value: unknown = Reflect.get(Object(entry), field)

    return typeof value !== "string" || value.trim() === ""
  })

  if (missing.length > 0) return `entry ${index} has no ${missing.join(", ")}`

  const text = (field: string) => String(Reflect.get(Object(entry), field))
  const id = text("id")
  const severity = text("severity")
  const reviewBy = text("reviewBy")

  if (!/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/.test(id))
    return `entry ${index}: ${id} is not a GHSA id`
  if (!isSeverity(severity))
    return `entry ${index}: severity "${severity}" is not one of ${SEVERITIES.join(", ")}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewBy) || Number.isNaN(Date.parse(reviewBy)))
    return `entry ${index}: reviewBy "${reviewBy}" is not a YYYY-MM-DD date`

  return undefined
}

/** The allowlist's entries, from its parsed JSON; throws on any malformed entry. */
export function parseAllowlist(json: unknown): AllowlistEntry[] {
  const advisories: unknown = Reflect.get(Object(json), "advisories")

  if (!Array.isArray(advisories)) throw new Error('the allowlist has no "advisories" array')

  const problems = advisories.flatMap((entry: unknown, index) => entryProblem(entry, index) ?? [])

  if (problems.length > 0)
    throw new Error(`the allowlist is malformed:\n  ${problems.join("\n  ")}`)

  return advisories.filter(isEntry)
}

/** Whether an allowlist entry is well formed. */
function isEntry(entry: unknown): entry is AllowlistEntry {
  return entryProblem(entry, 0) === undefined
}

/** Today's date as `YYYY-MM-DD`, in UTC. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** The entries whose review-by date is before `date` (`YYYY-MM-DD`). */
export function expired(entries: readonly AllowlistEntry[], date: string): AllowlistEntry[] {
  return entries.filter((entry) => entry.reviewBy < date)
}

/** The GHSA id at the end of an advisory's GitHub URL, or the URL when it has none. */
function advisoryId(url: string): string {
  return /GHSA(-[a-z0-9]{4}){3}$/i.exec(url)?.[0] ?? url
}

/** Whether parsed JSON looks like a `bun audit --json` report: each package's advisories. */
export function isAuditReport(json: unknown): json is AuditReport {
  return (
    typeof json === "object" &&
    json !== null &&
    !Array.isArray(json) &&
    Object.values(json).every(
      (advisories) =>
        Array.isArray(advisories) &&
        advisories.every(
          (advisory: unknown) => typeof Reflect.get(Object(advisory), "url") === "string",
        ),
    )
  )
}

/** Every advisory in a `bun audit --json` report, most severe first. */
export function findings(report: AuditReport): Finding[] {
  return Object.entries(report)
    .flatMap(([name, advisories]) =>
      advisories.map((advisory) => ({
        id: advisoryId(advisory.url),
        package: name,
        severity: advisory.severity,
        title: advisory.title,
        url: advisory.url,
      })),
    )
    .toSorted((a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity))
}

/** Whether a finding is severe enough to fail the scan. */
export function isBlocking(finding: Finding): boolean {
  return SEVERITIES.indexOf(finding.severity) >= SEVERITIES.indexOf(BLOCKING)
}

/** Whether a finding is covered by an allowlist entry still in date on `date`. */
export function isAllowed(
  finding: Finding,
  entries: readonly AllowlistEntry[],
  date: string,
): boolean {
  return entries.some(
    (entry) =>
      entry.id === finding.id && entry.package === finding.package && entry.reviewBy >= date,
  )
}

/** A TOML basic string. */
function tomlString(value: string): string {
  return JSON.stringify(value)
}

/** An OSV-Scanner config that ignores each entry until its review-by date. */
export function osvConfig(entries: readonly AllowlistEntry[]): string {
  const header =
    "# Written from .github/vulnerability-allowlist.json by scripts/audit.ts; do not edit.\n"

  return (
    header +
    entries
      .map(
        (entry) =>
          `\n[[IgnoredVulns]]\nid = ${tomlString(entry.id)}\nignoreUntil = ${entry.reviewBy}\n` +
          `reason = ${tomlString(`${entry.package}: ${entry.reason}`)}\n`,
      )
      .join("")
  )
}
