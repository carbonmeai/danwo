import { readFileSync } from "node:fs"

import { describe, expect, test } from "vitest"

import {
  type AllowlistEntry,
  expired,
  findings,
  isAllowed,
  isAuditReport,
  isBlocking,
  osvConfig,
  parseAllowlist,
  today,
} from "../vulnerabilities.ts"

const ALLOWLIST = new URL("../../.github/vulnerability-allowlist.json", import.meta.url)

const ENTRY: AllowlistEntry = {
  id: "GHSA-c475-qrg2-pj4r",
  package: "basic-ftp",
  path: "@danwo/example > pac-proxy-agent > get-uri > basic-ftp",
  severity: "high",
  reason: "Never reached.",
  reviewBy: "2027-01-21",
}

/** A `bun audit --json` advisory at `severity`, for the GHSA id `id`. */
function advisory(id: string, severity: AllowlistEntry["severity"]) {
  return {
    url: `https://github.com/advisories/${id}`,
    title: `${id} title`,
    severity,
    vulnerable_versions: "<=1.0.0",
  }
}

describe("the reviewed allowlist", () => {
  const entries = parseAllowlist(JSON.parse(readFileSync(ALLOWLIST, "utf8")))

  test("has no entry past its review-by date", () => {
    expect(expired(entries, today()).map((entry) => `${entry.id} (${entry.reviewBy})`)).toEqual([])
  })

  test("reviews each entry within about three months", () => {
    const now = new Date()
    const limit = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 4, now.getUTCDate()))

    expect(entries.filter((entry) => entry.reviewBy > today(limit))).toEqual([])
  })
})

describe("parseAllowlist", () => {
  test("reads well-formed entries", () => {
    expect(parseAllowlist({ advisories: [ENTRY] })).toEqual([ENTRY])
  })

  test("names each problem", () => {
    expect(() =>
      parseAllowlist({
        advisories: [
          { ...ENTRY, reason: " " },
          { ...ENTRY, id: "CVE-2026-1" },
          { ...ENTRY, severity: "severe" },
          { ...ENTRY, reviewBy: "January" },
        ],
      }),
    ).toThrow(
      /entry 0 has no reason\n.*entry 1: CVE-2026-1 is not a GHSA id\n.*entry 2: severity "severe".*\n.*entry 3: reviewBy "January"/,
    )
  })

  test("needs an advisories array", () => {
    expect(() => parseAllowlist({})).toThrow('no "advisories" array')
  })
})

describe("expired", () => {
  test("keeps an entry through its review-by day", () => {
    expect(expired([ENTRY], "2027-01-21")).toEqual([])
    expect(expired([ENTRY], "2027-01-22")).toEqual([ENTRY])
  })
})

describe("findings", () => {
  const report = {
    "basic-ftp": [advisory("GHSA-c475-qrg2-pj4r", "high")],
    lodash: [
      advisory("GHSA-aaaa-bbbb-cccc", "moderate"),
      advisory("GHSA-cccc-dddd-ffff", "critical"),
    ],
  }

  test("lists every advisory by its GHSA id, most severe first", () => {
    expect(
      findings(report).map((finding) => [finding.package, finding.id, finding.severity]),
    ).toEqual([
      ["lodash", "GHSA-cccc-dddd-ffff", "critical"],
      ["basic-ftp", "GHSA-c475-qrg2-pj4r", "high"],
      ["lodash", "GHSA-aaaa-bbbb-cccc", "moderate"],
    ])
  })

  test("blocks on high and critical only", () => {
    expect(findings(report).map(isBlocking)).toEqual([true, true, false])
  })

  test("recognises a report", () => {
    expect(isAuditReport(report)).toBe(true)
    expect(isAuditReport({})).toBe(true)
    expect(isAuditReport([])).toBe(false)
    expect(isAuditReport({ "basic-ftp": [{}] })).toBe(false)
  })
})

describe("isAllowed", () => {
  const [finding] = findings({ "basic-ftp": [advisory("GHSA-c475-qrg2-pj4r", "high")] })

  test("matches the advisory in the same package while the entry is in date", () => {
    expect(isAllowed(finding!, [ENTRY], "2027-01-21")).toBe(true)
    expect(isAllowed(finding!, [ENTRY], "2027-01-22")).toBe(false)
  })

  test("does not cover the advisory in another package", () => {
    expect(isAllowed({ ...finding!, package: "get-uri" }, [ENTRY], "2026-10-21")).toBe(false)
  })
})

describe("osvConfig", () => {
  test("ignores each entry until its review-by date", () => {
    expect(osvConfig([{ ...ENTRY, reason: 'Says "never".' }])).toContain(
      '[[IgnoredVulns]]\nid = "GHSA-c475-qrg2-pj4r"\nignoreUntil = 2027-01-21\nreason = "basic-ftp: Says \\"never\\"."\n',
    )
  })
})
