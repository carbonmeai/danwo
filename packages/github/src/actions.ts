/**
 * What a GitHub Actions job tells its steps through the environment: the repository, the commit a
 * check belongs to, the run's page, and where the job summary goes.
 */
import { readFile } from "node:fs/promises"

/** The Actions job a run is part of. */
export interface ActionsJob {
  readonly apiUrl: string
  readonly repository: string
  /** The commit checks attach to: a pull request's head, else the pushed commit. */
  readonly headSha: string
  /** The pull request the run is for; absent on a push or a schedule. */
  readonly pullRequest: number | undefined
  /** The run's page; artifacts are listed at its foot. */
  readonly runUrl: string
  /** Where the repository is checked out; annotation paths are relative to it. */
  readonly workspace: string | undefined
  /** The token for the REST API; checks need `checks: write`. Absent leaves only the summary. */
  readonly token: string | undefined
  /** The file the job summary is appended to. */
  readonly stepSummary: string | undefined
}

type Env = Readonly<Record<string, string | undefined>>

/** The pull request in the event payload: its number and head commit, when the event has one. */
async function pullRequestOf(
  eventPath: string | undefined,
): Promise<{ readonly number?: number; readonly headSha?: string }> {
  if (eventPath === undefined) return {}

  try {
    const event: { pull_request?: { number?: unknown; head?: { sha?: unknown } } } = JSON.parse(
      await readFile(eventPath, "utf8"),
    )
    const { number, head } = event.pull_request ?? {}

    return {
      ...(typeof number === "number" && { number }),
      ...(typeof head?.sha === "string" && { headSha: head.sha }),
    }
  } catch {
    return {}
  }
}

/** The job's page from the server, repository and run id. */
function runUrlOf(env: Env, repository: string): string {
  const server = env["GITHUB_SERVER_URL"] ?? "https://github.com"

  return `${server}/${repository}/actions/runs/${env["GITHUB_RUN_ID"] ?? ""}`
}

/**
 * The Actions job this process runs in, or why there is none: outside Actions, or without the
 * repository and commit a check needs.
 */
export async function actionsJob(env: Env): Promise<ActionsJob | string> {
  if (env["GITHUB_ACTIONS"] !== "true") return "not running in GitHub Actions"

  const repository = env["GITHUB_REPOSITORY"]
  const pull = await pullRequestOf(env["GITHUB_EVENT_PATH"])
  const headSha = pull.headSha ?? env["GITHUB_SHA"]

  if (repository === undefined || headSha === undefined)
    return "GITHUB_REPOSITORY or GITHUB_SHA is not set"

  return {
    apiUrl: env["GITHUB_API_URL"] ?? "https://api.github.com",
    repository,
    headSha,
    pullRequest: pull.number,
    runUrl: runUrlOf(env, repository),
    workspace: env["GITHUB_WORKSPACE"],
    token: env["GITHUB_TOKEN"] || undefined,
    stepSummary: env["GITHUB_STEP_SUMMARY"],
  }
}
