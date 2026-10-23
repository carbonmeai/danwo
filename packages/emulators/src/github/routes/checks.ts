import type { Context } from "../../http.ts"
import { repoAccess } from "../auth.ts"
import type { GithubRouteContext } from "../context.ts"
import type { CheckAnnotation, GithubCheckRunRecord, GithubRepoRecord } from "../entities.ts"
import { annotationObject, checkRunObject } from "../git-format.ts"
import { resolveCommit } from "../git.ts"
import {
  bodyOf,
  GithubApiError,
  given,
  invalid,
  missingField,
  nextGhId,
  notFound,
  paged,
  recordOf,
  stringField,
} from "../helpers.ts"
import type { GithubStore } from "../store.ts"

const READ = { permission: "checks", write: false } as const
const WRITE = { permission: "checks", write: true } as const

/** GitHub takes at most 50 annotations per request; more are sent in later updates. */
const MAX_ANNOTATIONS = 50

const STATUSES = ["queued", "in_progress", "completed", "waiting", "requested", "pending"] as const
const CONCLUSIONS = [
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
] as const
const LEVELS = ["notice", "warning", "failure"] as const

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return values.find((candidate) => candidate === value)
}

/** The fields every annotation must have, and their JSON types. */
const ANNOTATION_FIELDS = [
  ["path", "string"],
  ["message", "string"],
  ["start_line", "number"],
  ["end_line", "number"],
] as const

/** One annotation from the request, or a 422. */
function annotationOf(raw: unknown): CheckAnnotation {
  const record = recordOf(raw)
  const level = oneOf(LEVELS, record.annotation_level)
  const complete = ANNOTATION_FIELDS.every(([name, type]) => typeof record[name] === type)

  if (!complete || !level)
    throw invalid([{ resource: "CheckRun", field: "output.annotations", code: "invalid" }])

  return {
    path: String(record.path),
    start_line: Number(record.start_line),
    end_line: Number(record.end_line),
    annotation_level: level,
    message: String(record.message),
    title: stringField(record, "title") ?? null,
    raw_details: stringField(record, "raw_details") ?? null,
  }
}

/** The run's output text fields and annotations from a request's `output`. */
function outputOf(body: Record<string, unknown>) {
  const output = recordOf(body.output)
  const annotations = Array.isArray(output.annotations) ? output.annotations : []

  if (annotations.length > MAX_ANNOTATIONS)
    throw invalid([], `Only ${MAX_ANNOTATIONS} annotations are allowed per request`)

  return {
    fields: {
      ...given("title", stringField(output, "title")),
      ...given("summary", stringField(output, "summary")),
      ...given("text", stringField(output, "text")),
    },
    annotations: annotations.map(annotationOf),
  }
}

/**
 * Refuses a `status` or `conclusion` GitHub does not know, as its request schema does: a 422 that
 * names the field, with no `errors` list.
 */
function checkEnum(body: Record<string, unknown>, field: string, values: readonly string[]): void {
  const value = body[field]

  if (value === undefined || value === null || values.some((known) => known === value)) return

  throw new GithubApiError(
    422,
    `Invalid request.\n\nFor 'properties/${field}', ${JSON.stringify(value)} is not a member of ${JSON.stringify(values)}.`,
  )
}

/** Status, conclusion and times from a request: a conclusion completes the run. */
function progressOf(body: Record<string, unknown>, now: string): Partial<GithubCheckRunRecord> {
  checkEnum(body, "status", STATUSES)
  checkEnum(body, "conclusion", CONCLUSIONS)

  const conclusion = oneOf(CONCLUSIONS, body.conclusion)
  const status = conclusion ? "completed" : oneOf(STATUSES, body.status)

  return {
    ...(status && { status }),
    ...(conclusion && { conclusion, completedAt: stringField(body, "completed_at") ?? now }),
    ...(status === "in_progress" && { startedAt: stringField(body, "started_at") ?? now }),
    ...given("detailsUrl", stringField(body, "details_url")),
    ...given("externalId", stringField(body, "external_id")),
  }
}

/** Only an app can write check runs; its installation token says which app. */
function appIdOf(caller: ReturnType<typeof repoAccess>["caller"]): number {
  if (caller.kind === "installation") return caller.installation.appId
  if (caller.kind === "user" && caller.app) return caller.app.ghId

  throw new GithubApiError(403, "You must authenticate via a GitHub App.")
}

async function createRun(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo, caller, actor } = repoAccess(c, context, WRITE)
  const appId = appIdOf(caller)
  const body = await bodyOf(c)
  const name = stringField(body, "name")
  const headSha = stringField(body, "head_sha") ?? ""
  const now = context.clock().toISOString()

  if (!name) throw missingField("CheckRun", "name")
  if (!resolveCommit(gh, repo.id, headSha))
    throw invalid([{ resource: "CheckRun", field: "head_sha", code: "invalid" }])

  const { fields, annotations } = outputOf(body)
  const run = gh.checkRuns.insert({
    ghId: nextGhId(context.store),
    repoId: repo.id,
    appId,
    name,
    headSha,
    status: "queued",
    conclusion: null,
    startedAt: stringField(body, "started_at") ?? now,
    completedAt: null,
    externalId: null,
    detailsUrl: null,
    title: null,
    summary: null,
    text: null,
    ...fields,
    ...progressOf(body, now),
    annotations,
  })

  context.events.checkRun(run.conclusion ? "completed" : "created", repo, run, actor)

  return c.json(checkRunObject(gh, repo, run), 201)
}

function requireRun(gh: GithubStore, repo: GithubRepoRecord, id: number): GithubCheckRunRecord {
  const run = gh.checkRuns.findOneBy("ghId", id)

  if (!run || run.repoId !== repo.id) throw notFound()

  return run
}

async function updateRun(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo, caller, actor } = repoAccess(c, context, WRITE)
  const run = requireRun(gh, repo, Number(c.req.param("id")))

  if (appIdOf(caller) !== run.appId)
    throw new GithubApiError(
      403,
      "Invalid app_id `" +
        String(appIdOf(caller)) +
        "` - check run can only be modified by the GitHub App that created it.",
    )

  const body = await bodyOf(c)
  const { fields, annotations } = outputOf(body)
  const updated =
    gh.checkRuns.update(run.id, {
      ...given("name", stringField(body, "name")),
      ...fields,
      ...progressOf(body, context.clock().toISOString()),
      annotations: [...run.annotations, ...annotations],
    }) ?? run

  if (updated.conclusion && !run.conclusion)
    context.events.checkRun("completed", repo, updated, actor)

  return c.json(checkRunObject(gh, repo, updated))
}

/** The Checks API's check runs: created and completed by apps, read by anyone with access. */
export function checkRoutes(context: GithubRouteContext): void {
  const { app } = context
  const path = "/repos/:owner/:repo/check-runs"

  app.post(path, (c) => createRun(c, context))
  app.patch(`${path}/:id`, (c) => updateRun(c, context))
  app.get(`${path}/:id`, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)

    return c.json(checkRunObject(gh, repo, requireRun(gh, repo, Number(c.req.param("id")))))
  })
  app.get(`${path}/:id/annotations`, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)
    const run = requireRun(gh, repo, Number(c.req.param("id")))

    return c.json(paged(c, run.annotations).map((annotation) => annotationObject(repo, annotation)))
  })
  app.get("/repos/:owner/:repo/commits/:ref/check-runs", (c) => {
    const { gh, repo } = repoAccess(c, context, READ)
    const commit = resolveCommit(gh, repo.id, c.req.param("ref"))
    const name = c.req.query("check_name")
    const runs = gh.checkRuns
      .all()
      .filter(
        (run) =>
          run.repoId === repo.id &&
          run.headSha === commit?.sha &&
          (name === undefined || run.name === name),
      )

    return c.json({
      total_count: runs.length,
      check_runs: paged(c, runs).map((run) => checkRunObject(gh, repo, run)),
    })
  })
}
