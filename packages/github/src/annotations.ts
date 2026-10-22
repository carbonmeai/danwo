/**
 * Annotations for a run: one per failing test or faulted run, on the test file line its failure
 * passed through, so it shows inline on the pull request's diff.
 */
import { isAbsolute, relative, resolve, sep } from "node:path"

import type { RunOutcome } from "@danwo/matrix"
import type { LintFinding, MatrixRunReport, TestReport, TestRunReport } from "@danwo/runner/runner"
import { redactCredentials, testName } from "@danwo/runner/runner"

import type { Annotation } from "./checks.ts"

/** Longest message an annotation carries; GitHub allows more, but a diff is no place for it. */
const MAX_MESSAGE = 4000

/** Where annotation paths are relative to: the checkout, else the run's folder. */
export interface PathBase {
  readonly root: string
  readonly workspace: string
}

const FAILED = new Set(["failed", "timed-out", "interrupted"])

/** `file` (relative to the project root) as a repository path, with forward slashes. */
function repoPath(base: PathBase, file: string): string {
  const absolute = isAbsolute(file) ? file : resolve(base.root, file)

  return relative(base.workspace, absolute).split(sep).join("/")
}

/** Text safe to show: credential shapes redacted, cut to a length a diff can hold. */
export function shown(text: string, max = MAX_MESSAGE): string {
  const clean = redactCredentials(text)

  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** The test file a test id names: its first segment. */
export function fileOfTestId(id: string): string {
  return id.split(" › ")[0] ?? id
}

function testAnnotation(base: PathBase, report: TestReport): Annotation | undefined {
  const failing = report.attempts.find((attempt) => attempt.error !== undefined)
  const error = failing?.error

  if (error === undefined) return undefined

  const line = error.source?.line ?? 1

  return {
    path: repoPath(base, error.source?.file ?? fileOfTestId(report.id)),
    start_line: line,
    end_line: line,
    annotation_level: report.status === "flaky" ? "warning" : "failure",
    title: report.status === "flaky" ? `flaky: ${testName(report)}` : testName(report),
    message: shown(`${error.code}: ${error.message}`),
  }
}

/**
 * Warning annotations for integration lint findings, once per rule and message, on the test line
 * the finding happened at (the test file's first line when the step had none).
 */
function lintAnnotations(
  base: PathBase,
  findings: readonly { readonly finding: LintFinding; readonly file: string }[],
): Annotation[] {
  const seen = new Set<string>()

  return findings.flatMap(({ finding, file }) => {
    const key = `${finding.rule} ${finding.message}`

    if (seen.has(key)) return []
    seen.add(key)

    const source = finding.evidence.source ?? { file, line: 1 }

    return [
      {
        path: repoPath(base, source.file),
        start_line: source.line,
        end_line: source.line,
        annotation_level: "warning",
        title: `integration lint: ${finding.rule}`,
        message: shown(`${finding.message}\n${finding.hint}`),
      },
    ]
  })
}

/** Annotations for `danwo test`: failing and flaky tests, files that could not run, lint findings. */
export function testAnnotations(base: PathBase, run: TestRunReport): Annotation[] {
  const findings = run.reports.flatMap((report) =>
    report.attempts.flatMap((attempt) =>
      (attempt.lint ?? []).map((finding) => ({ finding, file: fileOfTestId(report.id) })),
    ),
  )

  return [...failureAnnotations(base, run), ...lintAnnotations(base, findings)]
}

function failureAnnotations(base: PathBase, run: TestRunReport): Annotation[] {
  const tests = run.reports
    .filter((report) => FAILED.has(report.status) || report.status === "flaky")
    .map((report) => testAnnotation(base, report))
    .filter((annotation) => annotation !== undefined)
  const files = run.brokenFiles.map((broken): Annotation => ({
    path: repoPath({ ...base, root: run.cwd }, broken.file),
    start_line: 1,
    end_line: 1,
    annotation_level: "failure",
    title: `${broken.file} could not run`,
    message: shown(broken.error),
  }))

  return [...tests, ...files]
}

/** What a faulted run's annotation says: its notes, then its error. */
function outcomeDetails(outcome: RunOutcome): string {
  const details = [...outcome.notes, ...(outcome.error ? [outcome.error] : [])].join("\n")

  return shown(details || outcome.status)
}

function outcomeAnnotation(base: PathBase, file: string, outcome: RunOutcome): Annotation {
  const source = outcome.source ?? { file, line: 1 }

  return {
    path: repoPath(base, source.file),
    start_line: source.line,
    end_line: source.line,
    annotation_level: outcome.status === "failed" ? "failure" : "warning",
    title: `${outcome.status === "not-judged" ? "not judged" : outcome.status}: ${outcome.fault?.label ?? "clean run"}`,
    message: outcomeDetails(outcome),
  }
}

/** Annotations for `danwo matrix`: every run that did not pass, the clean run included, and lint. */
export function matrixAnnotations(base: PathBase, run: MatrixRunReport): Annotation[] {
  const failures = [run.result.clean, ...run.result.runs]
    .filter((outcome) => outcome.status !== "passed")
    .map((outcome) => outcomeAnnotation(base, run.file, outcome))
  const findings = (run.lint ?? []).flatMap((trial) =>
    trial.findings.map((finding) => ({ finding, file: run.file })),
  )

  return [...failures, ...lintAnnotations(base, findings)]
}
