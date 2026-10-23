import { createHash } from "node:crypto"

import type { components } from "@octokit/openapi-types"

import type {
  GithubCommentRecord,
  GithubIssueRecord,
  GithubLabelRecord,
  GithubPullRecord,
  GithubRepoRecord,
  GithubReviewRecord,
} from "./entities.ts"
import { appObject, repositoryObject, userByLogin } from "./formatters.ts"
import { branchHead, diffTrees, history, mergeBase } from "./git.ts"
import { API, ghTime, inRepo, nodeId, WEB } from "./helpers.ts"
import type { GithubStore } from "./store.ts"

type Schemas = components["schemas"]

const fullName = (repo: GithubRepoRecord) => `${repo.owner}/${repo.name}`
const repoApi = (repo: GithubRepoRecord) => `${API}/repos/${fullName(repo)}`

/** How the author is related to the repository, as GitHub labels comments and issues. */
function association(repo: GithubRepoRecord, login: string) {
  return repo.owner === login ? "OWNER" : "NONE"
}

/** A label, with the archive fields GitHub answers with though its schema does not list them yet. */
export function labelObject(repo: GithubRepoRecord, label: GithubLabelRecord) {
  const shown = {
    id: label.ghId,
    node_id: nodeId("LA", label.ghId),
    url: `${repoApi(repo)}/labels/${encodeURIComponent(label.name)}`,
    name: label.name,
    description: label.description,
    color: label.color,
    default: false,
  } satisfies Schemas["label"]

  return { ...shown, archived_at: null, archived_by: null }
}

/** An issue's labels, in the order they were added; unknown names are skipped. */
function issueLabels(gh: GithubStore, repo: GithubRepoRecord, names: readonly string[]) {
  const labels = gh.labels.findBy("repoId", repo.id)

  return names.flatMap((name) => {
    const label = labels.find((candidate) => candidate.name === name)

    return label ? [labelObject(repo, label)] : []
  })
}

/** Where an issue that is a pull request points at its pull request. */
function pullLinks(repo: GithubRepoRecord, number: number, merged: string | null) {
  return {
    url: `${repoApi(repo)}/pulls/${number}`,
    html_url: `${WEB}/${fullName(repo)}/pull/${number}`,
    diff_url: `${WEB}/${fullName(repo)}/pull/${number}.diff`,
    patch_url: `${WEB}/${fullName(repo)}/pull/${number}.patch`,
    merged_at: merged,
  }
}

/** An issue, or a pull request seen through the issues API. */
export function issueObject(gh: GithubStore, repo: GithubRepoRecord, issue: GithubIssueRecord) {
  const url = `${repoApi(repo)}/issues/${issue.number}`
  const pull = issue.isPull
    ? gh.pulls.findBy("repoId", repo.id).find((p) => p.number === issue.number)
    : undefined
  const assignees = issue.assignees.map((login) => userByLogin(gh, login))

  return {
    id: issue.ghId,
    node_id: nodeId(issue.isPull ? "PR" : "I", issue.ghId),
    url,
    repository_url: repoApi(repo),
    labels_url: `${url}/labels{/name}`,
    comments_url: `${url}/comments`,
    events_url: `${url}/events`,
    html_url: `${WEB}/${fullName(repo)}/${issue.isPull ? "pull" : "issues"}/${issue.number}`,
    number: issue.number,
    state: issue.state,
    state_reason: issue.stateReason,
    title: issue.title,
    body: issue.body,
    user: userByLogin(gh, issue.author),
    labels: issueLabels(gh, repo, issue.labels),
    assignee: assignees[0] ?? null,
    assignees,
    milestone: null,
    locked: issue.locked,
    active_lock_reason: null,
    comments: issue.comments,
    ...(pull && { pull_request: pullLinks(repo, issue.number, pull.mergedAt), draft: pull.draft }),
    closed_at: issue.closedAt && ghTime(issue.closedAt),
    created_at: ghTime(issue.created_at),
    updated_at: ghTime(issue.updated_at),
    closed_by: issue.closedBy === null ? null : userByLogin(gh, issue.closedBy),
    author_association: association(repo, issue.author),
    performed_via_github_app: null,
    reactions: reactions(`${url}/reactions`),
    timeline_url: `${url}/timeline`,
    type: null,
    issue_field_values: [],
    sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
    issue_dependencies_summary: {
      blocked_by: 0,
      total_blocked_by: 0,
      blocking: 0,
      total_blocking: 0,
    },
    pinned_comment: null,
  } satisfies Schemas["issue"]
}

function reactions(url: string) {
  return {
    url,
    total_count: 0,
    "+1": 0,
    "-1": 0,
    laugh: 0,
    confused: 0,
    heart: 0,
    hooray: 0,
    eyes: 0,
    rocket: 0,
  }
}

/** The App a comment was made through, as the comment shows it: without its client id when new. */
function commentApp(gh: GithubStore, appId: number | null, created: boolean) {
  const app = appId === null ? undefined : gh.apps.findOneBy("ghId", appId)

  if (!app) return null

  const { client_id: _clientId, ...shown } = appObject(gh, app, true)

  return created ? shown : { ...shown, client_id: app.clientId }
}

/**
 * An issue or pull request comment, with the GitHub App it was made through. `pin` is shown on an
 * issue's comments, and on a pull request's only in the answer that creates one; the answer that
 * creates one also leaves the App's client id out, as GitHub does.
 */
export function commentObject(
  gh: GithubStore,
  repo: GithubRepoRecord,
  comment: GithubCommentRecord,
  created = false,
) {
  const issue = inRepo(gh.issues, repo.id, (row) => row.number === comment.issueNumber)
  const kind = issue?.isPull ? "pull" : "issues"

  return {
    id: comment.ghId,
    node_id: nodeId("IC", comment.ghId),
    url: `${repoApi(repo)}/issues/comments/${comment.ghId}`,
    html_url: `${WEB}/${fullName(repo)}/${kind}/${comment.issueNumber}#issuecomment-${comment.ghId}`,
    issue_url: `${repoApi(repo)}/issues/${comment.issueNumber}`,
    body: comment.body,
    user: userByLogin(gh, comment.author),
    created_at: ghTime(comment.created_at),
    updated_at: ghTime(comment.updated_at),
    author_association: association(repo, comment.author),
    performed_via_github_app: commentApp(gh, comment.appId, created),
    reactions: reactions(`${repoApi(repo)}/issues/comments/${comment.ghId}/reactions`),
    minimized: null,
    ...((created || !issue?.isPull) && { pin: null }),
  } satisfies Schemas["issue-comment"]
}

/** One side of a pull request: its branch, the commit it is at and its repository. */
function pullEnd(gh: GithubStore, repo: GithubRepoRecord, branch: string, sha: string) {
  return {
    label: `${repo.owner}:${branch}`,
    ref: branch,
    sha,
    user: userByLogin(gh, repo.owner),
    repo: repositoryObject(gh, repo, { as: "nested", access: "push" }),
  }
}

/**
 * The pull request's change: the commits on its head that its base does not have, and the files
 * between where the head left the base and the head.
 */
export function pullDiff(gh: GithubStore, repo: GithubRepoRecord, pull: GithubPullRecord) {
  const head = branchHead(gh, repo.id, pull.head)

  if (!head) return { head, commits: [], files: [] }

  const base = mergeBase(gh, head.sha, pull.baseSha)
  const inBase = new Set(history(gh, pull.baseSha).map((commit) => commit.sha))
  const from = base?.tree ?? gh.commits.findOneBy("sha", pull.baseSha)?.tree ?? {}

  return {
    head,
    commits: history(gh, head.sha).filter((commit) => !inBase.has(commit.sha)),
    files: diffTrees(gh, from, head.tree),
  }
}

function pullUrls(repo: GithubRepoRecord, number: number) {
  const url = `${repoApi(repo)}/pulls/${number}`

  return {
    url,
    issue_url: `${repoApi(repo)}/issues/${number}`,
    commits_url: `${url}/commits`,
    review_comments_url: `${url}/comments`,
    review_comment_url: `${repoApi(repo)}/pulls/comments{/number}`,
    comments_url: `${repoApi(repo)}/issues/${number}/comments`,
    statuses_url: `${repoApi(repo)}/statuses/{sha}`,
  }
}

/** The counts a full pull request carries. */
function pullCounts(gh: GithubStore, repo: GithubRepoRecord, pull: GithubPullRecord) {
  const { head, commits, files } = pullDiff(gh, repo, pull)

  return {
    head_sha: head?.sha ?? pull.baseSha,
    stats: {
      commits: commits.length,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      changed_files: files.length,
    },
  }
}

/**
 * Whether a pull request merges, and the commit GitHub made to test it, by its sha: unknown in the
 * answer that opens it, worked out in every later one.
 */
function mergeability(
  pull: GithubPullRecord,
  issue: GithubIssueRecord,
  ends: { readonly head: string; readonly base: string; readonly opened: boolean },
) {
  if (ends.opened)
    return { mergeable: null, rebaseable: null, mergeable_state: "unknown", merge_commit_sha: null }

  const mergeable = !pull.merged && issue.state === "open"
  const testMerge = createHash("sha1")
    .update(`test-merge ${pull.ghId} ${ends.head} ${ends.base}`)
    .digest("hex")

  return {
    mergeable,
    rebaseable: mergeable,
    mergeable_state: pull.merged ? "unknown" : "clean",
    merge_commit_sha: pull.mergeSha ?? testMerge,
  }
}

/**
 * A pull request as `GET /repos/{owner}/{repo}/pulls/{number}` shows it. The answer that opens one
 * comes before GitHub has worked out whether it merges: `mergeable` and `rebaseable` are null and
 * there is no test merge commit yet; every later answer has them.
 */
export function pullObject(
  gh: GithubStore,
  repo: GithubRepoRecord,
  pull: GithubPullRecord,
  issue: GithubIssueRecord,
  opened = false,
) {
  const { head_sha, stats } = pullCounts(gh, repo, pull)
  const base = branchHead(gh, repo.id, pull.base)
  const shown = issueObject(gh, repo, issue)
  const merges = mergeability(pull, issue, {
    head: head_sha,
    base: base?.sha ?? pull.baseSha,
    opened,
  })

  return {
    ...pullLinks(repo, pull.number, pull.mergedAt),
    ...pullUrls(repo, pull.number),
    id: pull.ghId,
    node_id: nodeId("PR", pull.ghId),
    number: pull.number,
    state: issue.state,
    locked: issue.locked,
    title: issue.title,
    user: shown.user,
    body: issue.body,
    labels: shown.labels,
    milestone: null,
    active_lock_reason: null,
    created_at: shown.created_at,
    updated_at: shown.updated_at,
    closed_at: shown.closed_at,
    merge_commit_sha: merges.merge_commit_sha,
    assignee: shown.assignee,
    assignees: shown.assignees,
    requested_reviewers: [],
    requested_teams: [],
    head: pullEnd(gh, repo, pull.head, head_sha),
    base: pullEnd(gh, repo, pull.base, base?.sha ?? pull.baseSha),
    _links: pullHal(repo, pull.number),
    author_association: shown.author_association,
    auto_merge: null,
    draft: pull.draft,
    merged: pull.merged,
    mergeable: merges.mergeable,
    rebaseable: merges.rebaseable,
    mergeable_state: merges.mergeable_state,
    merged_by: pull.mergedBy === null ? null : userByLogin(gh, pull.mergedBy),
    comments: issue.comments,
    review_comments: 0,
    maintainer_can_modify: false,
    ...stats,
  } satisfies Schemas["pull-request"]
}

const href = (value: string) => ({ href: value })

/** The `_links` block of a pull request. */
function pullHal(repo: GithubRepoRecord, number: number) {
  const urls = pullUrls(repo, number)

  return {
    self: href(urls.url),
    html: href(`${WEB}/${fullName(repo)}/pull/${number}`),
    issue: href(urls.issue_url),
    comments: href(urls.comments_url),
    review_comments: href(urls.review_comments_url),
    review_comment: href(urls.review_comment_url),
    commits: href(urls.commits_url),
    statuses: href(`${repoApi(repo)}/statuses/${number}`),
  }
}

export function reviewObject(gh: GithubStore, repo: GithubRepoRecord, review: GithubReviewRecord) {
  const pullUrl = `${repoApi(repo)}/pulls/${review.pullNumber}`
  const html = `${WEB}/${fullName(repo)}/pull/${review.pullNumber}#pullrequestreview-${review.ghId}`

  return {
    id: review.ghId,
    node_id: nodeId("PRR", review.ghId),
    user: userByLogin(gh, review.author),
    body: review.body,
    state: review.state,
    html_url: html,
    pull_request_url: pullUrl,
    _links: { html: { href: html }, pull_request: { href: pullUrl } },
    submitted_at: ghTime(review.created_at),
    commit_id: review.commitSha,
    author_association: association(repo, review.author),
  } satisfies Schemas["pull-request-review"]
}

/** One changed file of a pull request. */
export function diffEntryObject(
  repo: GithubRepoRecord,
  ref: string,
  file: ReturnType<typeof pullDiff>["files"][number],
) {
  return {
    sha: file.sha,
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.additions + file.deletions,
    blob_url: `${WEB}/${fullName(repo)}/blob/${ref}/${file.filename}`,
    raw_url: `${WEB}/${fullName(repo)}/raw/${ref}/${file.filename}`,
    contents_url: `${repoApi(repo)}/contents/${file.filename}?ref=${ref}`,
  } satisfies Schemas["diff-entry"]
}
