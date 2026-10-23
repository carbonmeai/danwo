/**
 * The pull request comment: one comment per pull request, found again by a hidden marker and
 * edited in place. Each run fills its own section: `danwo test` one per suite, and each `danwo
 * matrix` test one of its own. A section from an older commit is dropped when a run for a newer one arrives,
 * so the comment always describes the pull request's head. The whole stays under GitHub's comment
 * limit: a section that does not fit is cut between entries, with a note.
 */
import { createHash } from "node:crypto"

import type { RunOutcome } from "@danwo/matrix"
import {
  type MatrixRunReport,
  testName,
  type TestReport,
  type TestRunReport,
} from "@danwo/runner/runner"

import { shown } from "./annotations.ts"
import { type FailureDetails, failureDetails } from "./record-details.ts"
import type { SuiteIdentity } from "./suite.ts"
import {
  cell,
  FAILED,
  recordInArtifact,
  seconds,
  STATUS_MARK,
  verdictSplit,
  verdictText,
} from "./summary.ts"

/** Marks danwo's comment among the pull request's others. */
export const COMMENT_MARKER = "<!-- danwo:pr-comment -->"

/** GitHub's limit on a comment's body, in characters. */
export const MAX_COMMENT = 65_536

/** Room kept for a new section before older sections of the same commit are dropped. */
const MIN_SECTION = 4_000

/** Where a run's evidence is and which commit it ran on. */
export interface CommentLinks {
  /** The workflow run's page; its artifacts are listed at the foot. */
  readonly runUrl: string
  /** The artifact the workflow uploads `.danwo/runs` under. */
  readonly artifact: string
  /** Where the run's report or the dashboard is published, when it is. */
  readonly reportUrl: string | undefined
  /** The commit the run tested. */
  readonly sha: string
}

/** A run's part of the comment, as entries the size limit may cut between. */
export interface NewSection {
  readonly key: string
  readonly sha: string
  readonly blocks: readonly string[]
}

/** A section already in the comment. */
interface PostedSection {
  readonly key: string
  readonly sha: string
  readonly body: string
}

const SECTION = /<!-- danwo:section (\S+) sha=(\S+) -->\n([\s\S]*?)\n<!-- danwo:end \1 -->/g

const short = (sha: string) => sha.slice(0, 7)

/** Model spend, when the run called a model. */
function spend(usd: number, calls: number): string[] {
  return calls > 0 ? [`model $${usd.toFixed(4)}`] : []
}

/** The paragraph under a headline: time, spend, commit and the workflow run. */
function factsLine(durationMs: number, money: string[], links: CommentLinks): string {
  return `\n${[
    seconds(durationMs),
    ...money,
    `commit \`${short(links.sha)}\``,
    `[workflow run](${links.runUrl})`,
  ].join(" · ")}`
}

/** `text` as a link to the report, when one is published. */
function linked(text: string, links: CommentLinks): string {
  return links.reportUrl === undefined ? text : `[${text}](${links.reportUrl})`
}

function countOf(reports: readonly TestReport[], pick: (status: string) => boolean): number {
  return reports.filter((report) => pick(report.status)).length
}

/** `passed · failed`, then flaky, not judged and skipped when there are any. */
function testCounts(reports: readonly TestReport[]): string {
  const optional: [string, number][] = [
    ["flaky", countOf(reports, (s) => s === "flaky")],
    ["not judged", countOf(reports, (s) => s === "not-judged" || s === "invalid")],
    ["skipped", countOf(reports, (s) => s === "skipped")],
  ]

  return [
    `${countOf(reports, (s) => s === "passed")} passed`,
    `${countOf(reports, (s) => FAILED.has(s))} failed${verdictSplit(reports)}`,
    ...optional.filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`),
  ].join(" · ")
}

function testMark(run: TestRunReport): string {
  if (run.brokenFiles.length > 0 || run.reports.some((r) => FAILED.has(r.status))) return "❌"

  return run.reports.some((r) => r.status === "flaky") ? "⚠️" : "✅"
}

const durationOf = (report: TestReport) =>
  report.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0)

function testSpend(reports: readonly TestReport[]): string[] {
  const usages = reports.flatMap((r) => r.attempts.flatMap((a) => (a.usage ? [a.usage] : [])))

  return spend(
    usages.reduce((sum, usage) => sum + usage.spent.usd, 0),
    usages.reduce((sum, usage) => sum + usage.spent.calls, 0),
  )
}

function testRow(report: TestReport, links: CommentLinks): string {
  const mark = STATUS_MARK[report.status] ?? ""

  return `| ${mark} | ${linked(cell(testName(report)), links)} | ${seconds(durationOf(report))} | ${report.attempts.length - 1} |`
}

/** The table of every test that is not flaky or skipped, failures first. */
function testTable(run: TestRunReport, links: CommentLinks): string[] {
  const shownTests = run.reports.filter((r) => r.status !== "flaky" && r.status !== "skipped")
  const ordered = [
    ...shownTests.filter((r) => FAILED.has(r.status)),
    ...shownTests.filter((r) => !FAILED.has(r.status)),
  ]

  if (ordered.length === 0) return []

  return [
    "\n| | Test | Duration | Retries |\n|---|---|---|---|",
    ...ordered.map((r) => testRow(r, links)),
  ]
}

/** Where a record is: its folder inside the uploaded artifact. */
function recordLine(record: string, links: CommentLinks): string {
  return `- **Record:** \`${recordInArtifact(record)}\` in the \`${links.artifact}\` artifact of [this run](${links.runUrl}#artifacts)`
}

function detailLines(details: FailureDetails | undefined): string[] {
  if (details === undefined) return []

  return [
    ...(details.step ? [`- **Failing step:** \`${shown(details.step, 200)}\``] : []),
    ...(details.calls.length > 0
      ? ["- **Last provider calls:**", ...details.calls.map((c) => `  - \`${shown(c, 200)}\``)]
      : []),
    ...(details.faults.length > 0
      ? [`- **Faults:** ${details.faults.map((f) => `\`${shown(f, 200)}\``).join(", ")}`]
      : []),
  ]
}

/** A failure's summary line: its mark, test, error code and whose failure it was. */
function failureSummary(report: TestReport, error: TestReport["attempts"][0]["error"]): string {
  const verdict = report.attempts.at(-1)?.verdict
  const whose = verdict ? ` · ${verdictText(verdict)}` : ""

  return `<details><summary>${STATUS_MARK[report.status] ?? ""} ${cell(testName(report))}${error ? `: ${error.code}` : ""}${whose}</summary>`
}

/** The failure's "Whose" line: its verdict and the evidence behind it. */
function whoseLines(report: TestReport): string[] {
  const verdict = report.attempts.at(-1)?.verdict

  return verdict ? [`- **Whose:** ${verdictText(verdict)}: ${cell(verdict.reason)}`] : []
}

async function failureBlock(report: TestReport, cwd: string, links: CommentLinks): Promise<string> {
  const failing = report.attempts.findLast((attempt) => attempt.error !== undefined)
  const error = failing?.error
  const record = report.attempts.findLast((attempt) => attempt.record)?.record
  const where = error?.source ? ` (${error.source.file}:${error.source.line})` : ""

  return [
    failureSummary(report, error),
    "",
    ...whoseLines(report),
    ...(error
      ? [`- **Error:** \`${error.code}\` (${error.class}): ${cell(error.message)}${where}`]
      : []),
    ...detailLines(await failureDetails(cwd, record)),
    ...(record ? [recordLine(record, links)] : []),
    "",
    "</details>",
  ].join("\n")
}

function flakyBlock(run: TestRunReport): string[] {
  const flaky = run.reports.filter((r) => r.status === "flaky")

  if (flaky.length === 0) return []

  return [
    [
      `\n<details><summary>⚠️ ${flaky.length} flaky test${flaky.length === 1 ? "" : "s"}: passed on a retry</summary>`,
      "",
      "| Test | Attempts |",
      "|---|---|",
      ...flaky.map((r) => `| ${cell(testName(r))} | ${r.attempts.length} |`),
      "",
      "</details>",
    ].join("\n"),
  ]
}

/** Which suite a section is for; unnamed for a repository's one suite. */
export type SectionSuite = Pick<SuiteIdentity, "name" | "slug">

const UNNAMED: SectionSuite = { name: undefined, slug: undefined }

/** `danwo test` in a headline, followed by the suite's name when it has one. */
const titled = (command: string, suite: SectionSuite) =>
  suite.name === undefined ? command : `${command} · ${suite.name}`

/**
 * `danwo test`'s section: headline, a row per test, each failure folded, then flaky tests. A named
 * suite has a section of its own, so several suites' runs sit side by side.
 */
export async function testSection(
  run: TestRunReport,
  links: CommentLinks,
  suite: SectionSuite = UNNAMED,
): Promise<NewSection> {
  const failures = run.reports.filter((r) => FAILED.has(r.status))
  const blocks = await Promise.all(failures.map((r) => failureBlock(r, run.cwd, links)))

  return {
    key: suite.slug === undefined ? "test" : `test:${suite.slug}`,
    sha: links.sha,
    blocks: [
      `### ${testMark(run)} ${titled("danwo test", suite)} · ${testCounts(run.reports)}`,
      factsLine(run.durationMs, testSpend(run.reports), links),
      ...testTable(run, links),
      ...run.brokenFiles.map((b) => `\n❌ \`${b.file}\` could not run: ${cell(b.error)}`),
      ...(blocks.length > 0 ? ["\n#### Failures\n", ...blocks] : []),
      ...flakyBlock(run),
    ],
  }
}

/** What the matrix's verdict says in one sentence. */
function matrixHeadline(run: MatrixRunReport): string {
  const { clean, runs } = run.result

  if (clean.status !== "passed") return `**The clean run ${clean.status}: no faults were planned.**`

  const judge = run.judgedBy === "body" ? "test's body" : "invariant"
  const broke = runs.filter((outcome) => outcome.status === "failed").length
  const unjudged = runs.filter((o) => o.status !== "passed" && o.status !== "failed").length
  const verdict =
    broke > 0
      ? `The ${judge} broke under ${broke} of ${runs.length} faults.`
      : `The ${judge} held under all ${runs.length} faults.`

  return `**${verdict}**${unjudged > 0 ? ` ${unjudged} could not be judged.` : ""}`
}

function outcomeRow(outcome: RunOutcome): string {
  const details = [...outcome.notes, ...(outcome.error ? [outcome.error] : [])].join(" · ")

  return `| ${STATUS_MARK[outcome.status] ?? ""} | ${cell(outcome.fault?.label ?? "clean run")} | ${cell(details)} |`
}

function matrixRecords(outcomes: readonly RunOutcome[], links: CommentLinks): string[] {
  const records = outcomes.flatMap((o) =>
    o.record ? [`- ${cell(o.fault?.label ?? "clean run")}: \`${recordInArtifact(o.record)}\``] : [],
  )

  if (records.length === 0) return []

  return [
    [
      `\n<details><summary>Flight records</summary>`,
      "",
      `In the \`${links.artifact}\` artifact of [this run](${links.runUrl}#artifacts):`,
      "",
      ...records,
      "",
      "</details>",
    ].join("\n"),
  ]
}

/** `danwo matrix`'s section for one test: the verdict and a row per fault that did not hold. */
export function matrixSection(
  run: MatrixRunReport,
  links: CommentLinks,
  suite: SectionSuite = UNNAMED,
): NewSection {
  const outcomes = [run.result.clean, ...run.result.runs].filter((o) => o.status !== "passed")
  const broke = outcomes.length > 0
  const usage = run.usage?.spent
  /* Two suites may hold a test of the same id, so a named suite's tests are keyed apart. */
  const keyed = suite.slug === undefined ? run.testId : `${suite.slug}\n${run.testId}`

  return {
    key: `matrix:${createHash("sha1").update(keyed).digest("hex").slice(0, 10)}`,
    sha: links.sha,
    blocks: [
      `### ${broke ? "❌" : "✅"} ${titled("danwo matrix", suite)} · ${linked(cell(run.testId), links)}`,
      matrixHeadline(run),
      factsLine(run.durationMs, spend(usage?.usd ?? 0, usage?.calls ?? 0), links),
      ...(broke
        ? ["\n| | Fault | What happened |\n|---|---|---|", ...outcomes.map(outcomeRow)]
        : []),
      ...matrixRecords(outcomes, links),
    ],
  }
}

/** The sections already in a comment's body, in order. */
export function parseSections(body: string): PostedSection[] {
  return [...body.matchAll(SECTION)].map(([, key = "", sha = "", text = ""]) => ({
    key,
    sha,
    body: text,
  }))
}

const wrap = (key: string, sha: string, body: string) =>
  `<!-- danwo:section ${key} sha=${sha} -->\n${body}\n<!-- danwo:end ${key} -->`

/** `blocks` joined, as many as fit in `budget` characters, with a note for the rest. */
function fitBlocks(blocks: readonly string[], budget: number): string {
  const kept: string[] = []
  let used = 0

  for (const [index, block] of blocks.entries()) {
    const left = blocks.length - index
    const note = `\n\n_…${left} more ${left === 1 ? "entry" : "entries"} cut to fit GitHub's comment limit; the check run and the job summary have the rest._`

    if (used + block.length + 1 > budget - note.length) return [...kept, note].join("\n")

    kept.push(block)
    used += block.length + 1
  }

  return kept.join("\n")
}

/** Whether a section is a `danwo test` run's: the one suite's `test`, or a named suite's `test:…`. */
const isTestSection = (section: { readonly key: string }) =>
  section.key === "test" || section.key.startsWith("test:")

/**
 * The comment's new body: `section` put in place of the run's earlier section (or after the
 * others), sections of other commits dropped, `danwo test` first, all under GitHub's limit.
 */
export function commentBody(existing: string | undefined, section: NewSection): string {
  const kept = parseSections(existing ?? "").filter((s) => s.sha === section.sha)
  const position = kept.findIndex((s) => s.key === section.key)
  const others = kept.filter((s) => s.key !== section.key)
  const head = `${COMMENT_MARKER}\n## danwo`
  const foot = `<sub>For commit \`${short(section.sha)}\`; edited in place by each run.</sub>`
  /** What is left for the new section's text once everything else and the separators are in. */
  const room = () =>
    MAX_COMMENT -
    head.length -
    foot.length -
    wrap(section.key, section.sha, "").length -
    2 * (others.length + 2) -
    others.reduce((n, s) => n + wrap(s.key, s.sha, s.body).length, 0)

  while (others.length > 0 && room() < MIN_SECTION) others.pop()

  const fresh: PostedSection = { ...section, body: fitBlocks(section.blocks, room()) }
  const ordered =
    position === -1
      ? [...others, fresh]
      : others.toSpliced(Math.min(position, others.length), 0, fresh)
  const sorted = [...ordered.filter(isTestSection), ...ordered.filter((s) => !isTestSection(s))]

  return [head, ...sorted.map((s) => wrap(s.key, s.sha, s.body)), foot].join("\n\n")
}
