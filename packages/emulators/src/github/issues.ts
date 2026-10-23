import type { Store } from "../store.ts"
import type { GithubIssueRecord, GithubRepoRecord } from "./entities.ts"
import { inRepo, invalid, nextGhId, notFound } from "./helpers.ts"
import type { GithubStore } from "./store.ts"

/** Issue bookkeeping shared by the issues and pull request routes. */

/** Issue number `number` of a repository (pull requests included), or a 404. */
export function requireIssue(
  gh: GithubStore,
  repo: GithubRepoRecord,
  number: number,
): GithubIssueRecord {
  const issue = inRepo(gh.issues, repo.id, (row) => row.number === number)

  if (!issue) throw notFound()

  return issue
}

/** The default color GitHub gives a label created without one. */
const DEFAULT_COLOR = "ededed"

/** Labels by name, creating the ones the repository does not have yet. */
export function ensureLabels(
  gh: GithubStore,
  store: Store,
  repo: GithubRepoRecord,
  names: readonly string[],
): string[] {
  const existing = gh.labels.findBy("repoId", repo.id)

  for (const name of names)
    if (!existing.some((label) => label.name.toLowerCase() === name.toLowerCase()))
      gh.labels.insert({
        ghId: nextGhId(store),
        repoId: repo.id,
        name,
        color: DEFAULT_COLOR,
        description: null,
      })

  return names.map(
    (name) =>
      gh.labels
        .findBy("repoId", repo.id)
        .find((label) => label.name.toLowerCase() === name.toLowerCase())?.name ?? name,
  )
}

/** A new issue or pull request, numbered next in the repository's sequence. */
export function openIssue(
  gh: GithubStore,
  store: Store,
  repo: GithubRepoRecord,
  fields: {
    readonly title: string
    readonly body: string | null
    readonly author: string
    readonly isPull: boolean
  },
): GithubIssueRecord {
  if (fields.title.trim() === "")
    throw invalid([{ resource: "Issue", field: "title", code: "missing_field" }])

  gh.repos.update(repo.id, { nextNumber: repo.nextNumber + 1 })

  return gh.issues.insert({
    ghId: nextGhId(store),
    repoId: repo.id,
    number: repo.nextNumber,
    title: fields.title,
    body: fields.body,
    state: "open",
    stateReason: null,
    labels: [],
    assignees: [],
    author: fields.author,
    closedAt: null,
    closedBy: null,
    locked: false,
    isPull: fields.isPull,
    comments: 0,
  })
}

/** The fields that change when `by` closes or reopens an issue. */
export function stateChange(
  issue: GithubIssueRecord,
  state: "open" | "closed",
  reason: GithubIssueRecord["stateReason"],
  change: { readonly now: string; readonly by: string },
): Partial<GithubIssueRecord> {
  if (state === issue.state) return {}
  if (state === "closed")
    return { state, stateReason: reason ?? "completed", closedAt: change.now, closedBy: change.by }

  return { state, stateReason: "reopened", closedAt: null, closedBy: null }
}
