import type { components } from "@octokit/openapi-types"

import type {
  GithubCheckRunRecord,
  GithubCommitRecord,
  GithubHookRecord,
  GithubRepoRecord,
  GitPerson,
} from "./entities.ts"
import { appObject, userByLogin } from "./formatters.ts"
import { blobBytes, type FileDiff } from "./git.ts"
import { API, ghTime, nodeId, WEB } from "./helpers.ts"
import type { GithubStore } from "./store.ts"

type Schemas = components["schemas"]

const fullName = (repo: GithubRepoRecord) => `${repo.owner}/${repo.name}`
const repoApi = (repo: GithubRepoRecord) => `${API}/repos/${fullName(repo)}`

function person(who: GitPerson) {
  return { name: who.name, email: who.email, date: ghTime(who.date) }
}

/** The GitHub account a commit's email belongs to, if one does. */
function accountFor(gh: GithubStore, email: string) {
  const account = gh.accounts.all().find((a) => a.emails.some((e) => e.email === email))

  return account ? userByLogin(gh, account.login) : null
}

/** The git-level part of a commit. */
function gitCommit(repo: GithubRepoRecord, commit: GithubCommitRecord) {
  return {
    url: `${repoApi(repo)}/git/commits/${commit.sha}`,
    author: person(commit.author),
    committer: person(commit.committer),
    message: commit.message,
    comment_count: 0,
    tree: { sha: commit.treeSha, url: `${repoApi(repo)}/git/trees/${commit.treeSha}` },
    verification: {
      verified: false,
      reason: "unsigned",
      payload: null,
      signature: null,
      verified_at: null,
    },
  }
}

/** A commit as `GET /repos/{owner}/{repo}/commits/{ref}` shows it, with its changed files. */
export function commitObject(
  gh: GithubStore,
  repo: GithubRepoRecord,
  commit: GithubCommitRecord,
  files?: readonly FileDiff[],
) {
  const additions = files?.reduce((sum, file) => sum + file.additions, 0) ?? 0
  const deletions = files?.reduce((sum, file) => sum + file.deletions, 0) ?? 0

  return {
    url: `${repoApi(repo)}/commits/${commit.sha}`,
    sha: commit.sha,
    node_id: nodeId("C", commit.sha),
    html_url: `${WEB}/${fullName(repo)}/commit/${commit.sha}`,
    comments_url: `${repoApi(repo)}/commits/${commit.sha}/comments`,
    commit: gitCommit(repo, commit),
    author: accountFor(gh, commit.author.email),
    committer: accountFor(gh, commit.committer.email),
    parents: commit.parents.map((sha) => ({
      sha,
      url: `${repoApi(repo)}/commits/${sha}`,
      html_url: `${WEB}/${fullName(repo)}/commit/${sha}`,
    })),
    ...(files && {
      stats: { additions, deletions, total: additions + deletions },
      files: files.map((file) => ({
        ...file,
        changes: file.additions + file.deletions,
        blob_url: `${WEB}/${fullName(repo)}/blob/${commit.sha}/${file.filename}`,
        raw_url: `${WEB}/${fullName(repo)}/raw/${commit.sha}/${file.filename}`,
        contents_url: `${repoApi(repo)}/contents/${file.filename}?ref=${commit.sha}`,
      })),
    }),
  } satisfies Schemas["commit"]
}

/** The links every contents entry carries. */
function contentLinks(
  repo: GithubRepoRecord,
  path: string,
  ref: string,
  sha: string,
  type: string,
) {
  const self = `${repoApi(repo)}/contents/${path}?ref=${ref}`
  const git = `${repoApi(repo)}/git/${type === "dir" ? "trees" : "blobs"}/${sha}`
  const html = `${WEB}/${fullName(repo)}/${type === "dir" ? "tree" : "blob"}/${ref}/${path}`

  return { url: self, git_url: git, html_url: html, _links: { self, git, html } }
}

/** A file as `GET /repos/{owner}/{repo}/contents/{path}` shows it, content included. */
export function contentFile(
  gh: GithubStore,
  repo: GithubRepoRecord,
  path: string,
  ref: string,
  sha: string,
) {
  const bytes = blobBytes(gh, sha)

  return {
    type: "file" as const,
    encoding: "base64",
    size: bytes.length,
    name: path.split("/").at(-1) ?? path,
    path,
    content: (bytes.toString("base64").match(/.{1,60}/g) ?? []).join("\n"),
    sha,
    download_url: `https://raw.githubusercontent.com/${fullName(repo)}/${ref}/${path}`,
    ...contentLinks(repo, path, ref, sha, "file"),
  } satisfies Schemas["content-file"]
}

/** One entry of a directory listing: a file, or a directory found under a deeper path. */
export function directoryEntry(
  gh: GithubStore,
  repo: GithubRepoRecord,
  entry: { readonly path: string; readonly sha: string; readonly dir: boolean },
  ref: string,
) {
  const type = entry.dir ? "dir" : "file"

  return {
    type,
    size: entry.dir ? 0 : blobBytes(gh, entry.sha).length,
    name: entry.path.split("/").at(-1) ?? entry.path,
    path: entry.path,
    sha: entry.sha,
    download_url: entry.dir
      ? null
      : `https://raw.githubusercontent.com/${fullName(repo)}/${ref}/${entry.path}`,
    ...contentLinks(repo, entry.path, ref, entry.sha, type),
  } satisfies Schemas["content-directory"][number]
}

/** What `PUT` and `DELETE` on contents answer: the new file (if any) and the commit. */
export function fileCommit(
  gh: GithubStore,
  repo: GithubRepoRecord,
  commit: GithubCommitRecord,
  file: { readonly path: string; readonly ref: string } | null,
) {
  const sha = file ? commit.tree[file.path] : undefined
  const { verification, ...git } = gitCommit(repo, commit)

  return {
    content: file && sha ? contentFile(gh, repo, file.path, file.ref, sha) : null,
    commit: {
      sha: commit.sha,
      node_id: nodeId("C", commit.sha),
      html_url: `${WEB}/${fullName(repo)}/commit/${commit.sha}`,
      ...git,
      parents: commit.parents.map((parent) => ({
        sha: parent,
        url: `${repoApi(repo)}/git/commits/${parent}`,
        html_url: `${WEB}/${fullName(repo)}/commit/${parent}`,
      })),
      verification: { ...verification, payload: null, signature: null },
    },
  } satisfies Schemas["file-commit"]
}

export function shortBranch(repo: GithubRepoRecord, branch: { name: string; sha: string }) {
  return {
    name: branch.name,
    commit: { sha: branch.sha, url: `${repoApi(repo)}/commits/${branch.sha}` },
    protected: false,
  } satisfies Schemas["short-branch"]
}

/** A branch as `GET /repos/{owner}/{repo}/branches/{branch}` shows it. */
export function branchObject(
  gh: GithubStore,
  repo: GithubRepoRecord,
  name: string,
  head: GithubCommitRecord,
) {
  const url = `${repoApi(repo)}/branches/${name}`

  return {
    name,
    commit: commitObject(gh, repo, head),
    _links: { html: `${WEB}/${fullName(repo)}/tree/${name}`, self: url },
    protected: false,
    protection: {
      enabled: false,
      required_status_checks: { enforcement_level: "off", contexts: [], checks: [] },
    },
    protection_url: `${url}/protection`,
  } satisfies Schemas["branch-with-protection"]
}

export function refObject(repo: GithubRepoRecord, ref: { ref: string; sha: string }) {
  return {
    ref: ref.ref,
    node_id: nodeId("REF", ref.ref),
    url: `${repoApi(repo)}/git/${ref.ref}`,
    object: { type: "commit", sha: ref.sha, url: `${repoApi(repo)}/git/commits/${ref.sha}` },
  } satisfies Schemas["git-ref"]
}

/** A check run, as the Checks API shows it. */
export function checkRunObject(gh: GithubStore, repo: GithubRepoRecord, run: GithubCheckRunRecord) {
  const app = gh.apps.findOneBy("ghId", run.appId)
  const url = `${repoApi(repo)}/check-runs/${run.ghId}`

  return {
    id: run.ghId,
    head_sha: run.headSha,
    node_id: nodeId("CR", run.ghId),
    external_id: run.externalId,
    url,
    html_url: `${WEB}/${fullName(repo)}/runs/${run.ghId}`,
    details_url: run.detailsUrl,
    status: run.status,
    conclusion: run.conclusion,
    started_at: run.startedAt && ghTime(run.startedAt),
    completed_at: run.completedAt && ghTime(run.completedAt),
    output: {
      title: run.title,
      summary: run.summary,
      text: run.text,
      annotations_count: run.annotations.length,
      annotations_url: `${url}/annotations`,
    },
    name: run.name,
    check_suite: { id: run.ghId },
    app: app ? appObject(gh, app) : null,
    pull_requests: [],
  } satisfies Schemas["check-run"]
}

/** One annotation of a check run, with the fields the API adds. */
export function annotationObject(
  repo: GithubRepoRecord,
  annotation: GithubCheckRunRecord["annotations"][number],
) {
  return {
    ...annotation,
    start_column: null,
    end_column: null,
    blob_href: `${WEB}/${fullName(repo)}/blob/HEAD/${annotation.path}`,
  } satisfies Schemas["check-annotation"]
}

/** A repository webhook, without its secret. */
export function hookObject(repo: GithubRepoRecord, hook: GithubHookRecord) {
  const url = `${repoApi(repo)}/hooks/${hook.ghId}`

  return {
    type: "Repository",
    id: hook.ghId,
    name: "web",
    active: hook.active,
    events: hook.events,
    config: {
      url: hook.url,
      content_type: hook.contentType,
      insecure_ssl: "0",
      ...(hook.secret && { secret: "********" }),
    },
    updated_at: ghTime(hook.updated_at),
    created_at: ghTime(hook.created_at),
    url,
    test_url: `${url}/test`,
    ping_url: `${url}/pings`,
    deliveries_url: `${url}/deliveries`,
    last_response: { code: null, status: "unused", message: null },
  } satisfies Schemas["hook"]
}
