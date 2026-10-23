/**
 * The GitHub reporter: inside a GitHub Actions job it opens a check run when the run starts, adds
 * an annotation for every failure, completes the check with a conclusion and summary, and appends
 * the same summary to the job summary. On a pull request it also keeps one comment up to date with
 * every run's results. Outside Actions, without a token, or without permission it says why and
 * leaves the run alone: reporting never fails a run. A repository with several suites reports each
 * under its own name (see `suite.ts`).
 */
import { appendFile } from "node:fs/promises"

import type {
  MatrixRunReport,
  Reporter,
  RunContext,
  RunKind,
  TestRunReport,
} from "@danwo/runner/runner"

import { type ActionsJob, actionsJob } from "./actions.ts"
import { matrixAnnotations, shown, testAnnotations } from "./annotations.ts"
import {
  ANNOTATIONS_PER_REQUEST,
  type Annotation,
  type ChecksClient,
  checksClient,
  type Conclusion,
} from "./checks.ts"
import { PullRequestComment } from "./comment-poster.ts"
import { explainRefusal } from "./request.ts"
import { checkName, type SuiteIdentity, suiteIdentity } from "./suite.ts"
import { matrixSummary, matrixTitle, testSummary, testTitle } from "./summary.ts"

export interface GitHubReporterOptions {
  /**
   * The check run's name; default `danwo` for `danwo test` and `danwo matrix` for the matrix,
   * followed by the suite's name when it has one (`danwo · dashboard`).
   */
  readonly name?: string
  /**
   * The artifact name the workflow uploads `.danwo/runs` under; default `danwo-runs`, or
   * `danwo-runs-<suite>` for a named suite.
   */
  readonly artifact?: string
  /** The environment to read the job from; default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly fetch?: typeof fetch
  /** Where warnings go; default stderr. */
  readonly log?: (line: string) => void
  /**
   * Keep one comment on the pull request up to date with the run's results; default on, off with
   * `false`, `--no-pr-comment` or `DANWO_PR_COMMENT=off`. Needs `pull-requests: write`.
   */
  readonly prComment?: boolean
  /**
   * Where the run's report or the dashboard is published, which test names in the comment link
   * to; default `DANWO_REPORT_URL`.
   */
  readonly reportUrl?: string
}

/** `DANWO_PR_COMMENT` values that turn the comment off. */
const OFF = new Set(["0", "false", "off", "no"])

/** A finished run, ready to post: its conclusion, title, summary and annotations. */
interface Verdict {
  readonly conclusion: Conclusion
  readonly title: string
  readonly summary: string
  readonly annotations: readonly Annotation[]
}

/** Why a check run request failed, worded as what to do about it. */
const explain = (error: unknown) => explainRefusal(error, "check run", "checks: write")

/** `annotations` in request-sized batches; the last one goes with the completing request. */
function batches(annotations: readonly Annotation[]): Annotation[][] {
  const out: Annotation[][] = []

  for (let at = 0; at < annotations.length; at += ANNOTATIONS_PER_REQUEST)
    out.push(annotations.slice(at, at + ANNOTATIONS_PER_REQUEST))

  return out.length > 0 ? out : [[]]
}

function testVerdict(run: TestRunReport, job: ActionsJob, suite: SuiteIdentity): Verdict {
  const failed =
    run.brokenFiles.length > 0 ||
    run.reports.some((r) => ["failed", "timed-out", "interrupted"].includes(r.status))

  return {
    conclusion: failed ? "failure" : "success",
    title: testTitle(run),
    summary: testSummary(run, { runUrl: job.runUrl, artifact: suite.artifact }, suite.name),
    annotations: testAnnotations({ root: run.root, workspace: job.workspace ?? run.cwd }, run),
  }
}

function matrixVerdict(run: MatrixRunReport, job: ActionsJob, suite: SuiteIdentity): Verdict {
  const outcomes = [run.result.clean, ...run.result.runs]

  return {
    conclusion: outcomes.every((o) => o.status === "passed") ? "success" : "failure",
    title: matrixTitle(run),
    summary: matrixSummary(run, { runUrl: job.runUrl, artifact: suite.artifact }, suite.name),
    annotations: matrixAnnotations({ root: run.root, workspace: job.workspace ?? run.cwd }, run),
  }
}

/** One run's check: opened at the start, filled and completed at the end. */
class CheckRun {
  private id: number | undefined
  private disabled = false
  private readonly client: ChecksClient
  private readonly name: string
  private readonly job: ActionsJob
  private readonly log: (line: string) => void

  constructor(client: ChecksClient, name: string, job: ActionsJob, log: (line: string) => void) {
    this.client = client
    this.name = name
    this.job = job
    this.log = log
  }

  async open(): Promise<void> {
    if (this.id !== undefined || this.disabled) return

    try {
      this.id = await this.client.create(this.name, this.job.headSha, this.job.runUrl)
    } catch (error) {
      this.disabled = true
      this.log(`github: no check run: ${explain(error)}`)
    }
  }

  async finish(verdict: Verdict): Promise<void> {
    await this.open()
    if (this.id === undefined) return

    const parts = batches(verdict.annotations)
    const output = (annotations: readonly Annotation[]) => ({
      title: verdict.title,
      summary: verdict.summary,
      annotations,
    })

    try {
      for (const part of parts.slice(0, -1)) await this.client.update(this.id, output(part))
      await this.client.complete(this.id, verdict.conclusion, output(parts.at(-1) ?? []))
    } catch (error) {
      this.log(`github: the check run was not completed: ${explain(error)}`)
    }
  }
}

/** Appends the summary to the job summary, when the job has one. */
async function writeStepSummary(job: ActionsJob, summary: string, log: (line: string) => void) {
  if (job.stepSummary === undefined) return

  try {
    await appendFile(job.stepSummary, `${summary}\n\n`)
  } catch (error) {
    log(`github: no job summary: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Reports danwo runs to GitHub from an Actions job; see the module comment. */
export function github(options: GitHubReporterOptions = {}): Reporter {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  let job: Promise<ActionsJob | string> | undefined
  const checks = new Map<RunKind, CheckRun>()
  const suites = new Map<RunKind, SuiteIdentity>()
  const env = options.env ?? process.env
  const comment = new PullRequestComment({
    enabled: options.prComment ?? !OFF.has((env["DANWO_PR_COMMENT"] ?? "").toLowerCase()),
    reportUrl: options.reportUrl ?? (env["DANWO_REPORT_URL"] || undefined),
    fetch: options.fetch ?? fetch,
    log,
  })

  const jobOnce = () => (job ??= actionsJob(env))

  /** The run's suite, worked out once per command from its first report. */
  function suiteFor(run: RunContext, found: ActionsJob): SuiteIdentity {
    const known = suites.get(run.kind)

    if (known !== undefined) return known

    const suite = suiteIdentity(run, found.workspace ?? run.cwd, {
      ...(options.artifact !== undefined && { artifact: options.artifact }),
    })

    suites.set(run.kind, suite)

    return suite
  }

  /** The run's check, or none outside Actions or without a token (said once, on first use). */
  async function checkFor(run: RunContext): Promise<CheckRun | undefined> {
    const found = await jobOnce()

    if (typeof found === "string" || found.token === undefined) return undefined

    const existing = checks.get(run.kind)

    if (existing !== undefined) return existing

    const client = checksClient({
      apiUrl: found.apiUrl,
      repository: found.repository,
      token: found.token,
      fetch: options.fetch ?? fetch,
    })
    const name = options.name ?? checkName(run.kind, suiteFor(run, found))
    const check = new CheckRun(client, name, found, log)

    checks.set(run.kind, check)

    return check
  }

  async function started(run: RunContext): Promise<void> {
    const found = await jobOnce()

    if (typeof found === "string") log(`github: ${found}; no check run or job summary`)
    else if (found.token === undefined)
      log("github: GITHUB_TOKEN is not set; writing the job summary only")

    await (await checkFor(run))?.open()
  }

  async function finished(
    run: RunContext,
    verdict: (job: ActionsJob, suite: SuiteIdentity) => Verdict,
    commented?: (job: ActionsJob, suite: SuiteIdentity) => Promise<void>,
  ): Promise<void> {
    const found = await jobOnce()

    if (typeof found === "string") return

    const suite = suiteFor(run, found)
    const result = verdict(found, suite)

    await writeStepSummary(found, result.summary, log)
    await (await checkFor(run))?.finish(result)
    await commented?.(found, suite)
  }

  return {
    name: "github",
    started,
    testsFinished: (run) =>
      finished(
        run,
        (found, suite) => testVerdict(run, found, suite),
        (found, suite) => comment.tests(found, run, suite),
      ),
    matrixFinished: (run) =>
      finished(
        run,
        (found, suite) => matrixVerdict(run, found, suite),
        (found, suite) => comment.matrix(found, run, suite),
      ),
    async aborted(run) {
      const reason = `the run stopped before it had a result: ${shown(run.error)}`

      await finished(run, (_found, suite) => ({
        conclusion: "failure",
        title: "run aborted",
        summary: `### ${checkName(run.kind, suite)}: run aborted\n\n${reason}`,
        annotations: [],
      }))
    },
  }
}
