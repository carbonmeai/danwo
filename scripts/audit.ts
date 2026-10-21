/**
 * Scans the workspace's dependencies, as `bun.lock` pins them, for known vulnerabilities.
 *
 * Usage: `node scripts/audit.ts [--osv-config <file>]`
 *
 * Runs `bun audit --json`, lists every advisory, and exits non-zero when one is high or critical and
 * not covered by an in-date entry in `.github/vulnerability-allowlist.json`. With `--osv-config` it
 * instead writes an OSV-Scanner config that ignores the same entries until their review-by dates.
 * The decisions live in `vulnerabilities.ts`.
 */
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  type AuditReport,
  expired,
  type Finding,
  findings,
  isAllowed,
  isAuditReport,
  isBlocking,
  osvConfig,
  parseAllowlist,
  today,
} from "./vulnerabilities.ts"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const ALLOWLIST = fileURLToPath(new URL("../.github/vulnerability-allowlist.json", import.meta.url))

const entries = parseAllowlist(JSON.parse(readFileSync(ALLOWLIST, "utf8")))
const date = today()
const osvIndex = process.argv.indexOf("--osv-config")

/** `bun audit --json` over the lockfile; it exits non-zero whenever it finds anything. */
function audit(): AuditReport {
  const result = spawnSync("bun", ["audit", "--json"], { cwd: ROOT, encoding: "utf8" })

  let report: unknown

  try {
    report = JSON.parse(result.stdout)
  } catch {
    report = undefined
  }

  if (!isAuditReport(report))
    throw new Error(`bun audit gave no report (exit ${result.status}):\n${result.stderr}`)

  return report
}

/** One line for a finding: its severity, package, id and title, and whether it is allowlisted. */
function line(finding: Finding): string {
  const allowed = isAllowed(finding, entries, date) ? " (allowlisted)" : ""

  return `${finding.severity.padEnd(8)} ${finding.package} ${finding.id}${allowed}\n         ${finding.title}\n         ${finding.url}`
}

if (osvIndex !== -1) {
  const file = process.argv[osvIndex + 1]

  if (file === undefined) throw new Error("--osv-config needs a file")

  writeFileSync(file, osvConfig(entries))
} else {
  const found = findings(audit())
  const blocking = found.filter(
    (finding) => isBlocking(finding) && !isAllowed(finding, entries, date),
  )

  for (const finding of found) console.log(line(finding))
  for (const entry of expired(entries, date))
    console.error(
      `${entry.id} (${entry.package}) was due for review by ${entry.reviewBy}; review it again or remove it.`,
    )

  console.log(
    `\n${found.length} advisories, ${blocking.length} high or critical and not allowlisted.`,
  )

  if (blocking.length > 0) {
    console.error(
      "Bump the package if a fixed version fits the pins; otherwise add a reviewed entry to .github/vulnerability-allowlist.json.",
    )
    process.exitCode = 1
  }
}
