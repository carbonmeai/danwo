import type { Context } from "../../http.ts"
import { repoAccess, requireGrant } from "../auth.ts"
import type { GithubRouteContext } from "../context.ts"
import type { GithubIssueRecord, GithubRepoRecord } from "../entities.ts"
import { bodyOf, GithubApiError, given, paged, stringField, stringsField } from "../helpers.ts"
import { issueObject, labelObject } from "../issue-format.ts"
import { ensureLabels, openIssue, requireIssue, stateChange } from "../issues.ts"
import type { GithubStore } from "../store.ts"

const READ = { permission: "issues", write: false } as const
const WRITE = { permission: "issues", write: true } as const

/** The issue filters GitHub's list takes: state, labels, creator and assignee. */
function matchesFilters(c: Context, issue: GithubIssueRecord): boolean {
  const state = c.req.query("state") ?? "open"
  const labels = (c.req.query("labels") ?? "").split(",").filter(Boolean)
  const creator = c.req.query("creator")
  const assignee = c.req.query("assignee")

  return (
    (state === "all" || issue.state === state) &&
    labels.every((label) => issue.labels.includes(label)) &&
    (creator === undefined || issue.author === creator) &&
    (assignee === undefined || issue.assignees.includes(assignee))
  )
}

/** Newest first by default; `?direction=asc` for oldest first. */
function sortedIssues(c: Context, issues: GithubIssueRecord[]): GithubIssueRecord[] {
  const by = c.req.query("sort") === "updated" ? "updated_at" : "created_at"
  const sign = c.req.query("direction") === "asc" ? 1 : -1

  return issues.toSorted((a, b) => sign * (a[by].localeCompare(b[by]) || a.number - b.number))
}

/** Tells hooks and apps about an issue change: a pull request's change is a `pull_request` event. */
function announce(
  context: GithubRouteContext,
  repo: GithubRepoRecord,
  issue: GithubIssueRecord,
  change: { readonly action: "edited" | "closed" | "reopened"; readonly actor: string },
): void {
  const pull = issue.isPull
    ? context
        .github()
        .pulls.findBy("repoId", repo.id)
        .find((p) => p.number === issue.number)
    : undefined

  if (pull) context.events.pull(change.action, repo, { pull, issue }, change.actor)
  else context.events.issue(change.action, repo, issue, change.actor)
}

/** The label events for labels added and removed. */
function announceLabels(
  context: GithubRouteContext,
  repo: GithubRepoRecord,
  before: readonly string[],
  issue: GithubIssueRecord,
  actor: string,
): void {
  for (const label of issue.labels.filter((name) => !before.includes(name)))
    context.events.issue("labeled", repo, issue, actor, label)
  for (const label of before.filter((name) => !issue.labels.includes(name)))
    context.events.issue("unlabeled", repo, issue, actor, label)
}

/**
 * Opens an issue. A token without the issues permission is refused first; then a body without a
 * title, as GitHub validates the request before it looks at the repository.
 */
async function createIssue(c: Context, context: GithubRouteContext): Promise<Response> {
  requireGrant(c, context, WRITE)

  const body = await bodyOf(c)
  const title = stringField(body, "title")

  if (title === undefined)
    throw new GithubApiError(422, 'Invalid request.\n\n"title" wasn\'t supplied.')

  const { gh, repo, actor } = repoAccess(c, context, WRITE)
  const issue = openIssue(gh, context.store, repo, {
    title,
    body: stringField(body, "body") ?? null,
    author: actor,
    isPull: false,
  })
  const labels = ensureLabels(gh, context.store, repo, stringsField(body, "labels") ?? [])
  const created =
    gh.issues.update(issue.id, { labels, assignees: stringsField(body, "assignees") ?? [] }) ??
    issue

  context.events.issue("opened", repo, created, actor)

  return c.json(issueObject(gh, repo, created), 201)
}

/** The changes a `PATCH` asks for, as record fields. */
function issueChanges(
  gh: GithubStore,
  context: GithubRouteContext,
  repo: GithubRepoRecord,
  issue: GithubIssueRecord,
  request: { readonly body: Record<string, unknown>; readonly actor: string },
): Partial<GithubIssueRecord> {
  const { body, actor } = request
  const state = stringField(body, "state")
  const labels = stringsField(body, "labels")
  const reason = stringField(body, "state_reason")

  return {
    ...given("title", stringField(body, "title")),
    ...("body" in body && { body: stringField(body, "body") ?? null }),
    ...(labels && { labels: ensureLabels(gh, context.store, repo, labels) }),
    ...given("assignees", stringsField(body, "assignees")),
    ...((state === "open" || state === "closed") &&
      stateChange(issue, state, reason === "not_planned" ? "not_planned" : null, {
        now: context.clock().toISOString(),
        by: actor,
      })),
  }
}

async function updateIssue(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo, actor } = repoAccess(c, context, WRITE)
  const issue = requireIssue(gh, repo, Number(c.req.param("number")))
  const changes = issueChanges(gh, context, repo, issue, { body: await bodyOf(c), actor })
  const updated = gh.issues.update(issue.id, changes) ?? issue

  if (changes.title !== undefined || changes.body !== undefined)
    announce(context, repo, updated, { action: "edited", actor })
  if (changes.state)
    announce(context, repo, updated, {
      action: changes.state === "closed" ? "closed" : "reopened",
      actor,
    })
  announceLabels(context, repo, issue.labels, updated, actor)

  return c.json(issueObject(gh, repo, updated))
}

/** Adds, replaces or removes an issue's labels and answers with the labels it ends up with. */
async function relabel(
  c: Context,
  context: GithubRouteContext,
  next: (current: readonly string[], asked: readonly string[]) => string[],
): Promise<Response> {
  const sends = c.req.method === "POST" || c.req.method === "PUT"
  const { gh, repo, actor } = repoAccess(c, context, c.req.method === "GET" ? READ : WRITE)
  const issue = requireIssue(gh, repo, Number(c.req.param("number")))
  const body = sends ? await bodyOf(c) : {}
  const asked = ensureLabels(gh, context.store, repo, stringsField(body, "labels") ?? [])
  const updated = gh.issues.update(issue.id, { labels: next(issue.labels, asked) }) ?? issue

  announceLabels(context, repo, issue.labels, updated, actor)

  const labels = gh.labels.findBy("repoId", repo.id)

  return c.json(
    updated.labels.flatMap((name) => {
      const label = labels.find((l) => l.name === name)

      return label ? [labelObject(repo, label)] : []
    }),
  )
}

/** Issues: list, create, read and update, and an issue's labels. */
export function issueRoutes(context: GithubRouteContext): void {
  const { app } = context
  const path = "/repos/:owner/:repo/issues"

  app.get(path, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)
    const issues = sortedIssues(
      c,
      gh.issues.findBy("repoId", repo.id).filter((issue) => matchesFilters(c, issue)),
    )

    return c.json(paged(c, issues).map((issue) => issueObject(gh, repo, issue)))
  })
  app.post(path, (c) => createIssue(c, context))
  app.get(`${path}/:number`, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)

    return c.json(issueObject(gh, repo, requireIssue(gh, repo, Number(c.req.param("number")))))
  })
  app.patch(`${path}/:number`, (c) => updateIssue(c, context))

  app.get(`${path}/:number/labels`, (c) => relabel(c, context, (current) => [...current]))
  app.post(`${path}/:number/labels`, (c) =>
    relabel(c, context, (current, asked) => [...new Set([...current, ...asked])]),
  )
  app.put(`${path}/:number/labels`, (c) => relabel(c, context, (_current, asked) => [...asked]))
  app.delete(`${path}/:number/labels`, (c) => relabel(c, context, () => []))
  app.delete(`${path}/:number/labels/:name`, (c) =>
    relabel(c, context, (current) => current.filter((name) => name !== c.req.param("name"))),
  )
}
