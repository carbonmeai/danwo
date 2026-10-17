import { createHash, randomBytes } from "node:crypto"

import type { GithubCommitRecord, GithubRepoRecord, GitPerson } from "./entities.ts"
import { inRepo } from "./helpers.ts"
import type { GithubStore } from "./store.ts"

/**
 * Each repository's git history, kept simply: a commit stores its whole tree as a map from path
 * to blob sha, and branches are `refs/heads/*` refs pointing at commits. Blob shas are real git
 * blob shas; commit and tree shas are unique 40-character hashes.
 */

const sha1 = (data: string | Buffer) => createHash("sha1").update(data).digest("hex")

/** The git blob sha of `content`, as `git hash-object` computes it. */
function blobSha(content: Buffer): string {
  return sha1(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content]))
}

/** Stores a blob once and returns its sha. */
function putBlob(gh: GithubStore, content: Buffer): string {
  const sha = blobSha(content)

  if (!gh.blobs.findOneBy("sha", sha))
    gh.blobs.insert({ sha, content: content.toString("base64"), size: content.length })

  return sha
}

/** A blob's bytes; a missing blob is empty. */
export function blobBytes(gh: GithubStore, sha: string): Buffer {
  return Buffer.from(gh.blobs.findOneBy("sha", sha)?.content ?? "", "base64")
}

const branchRef = (branch: string) => `refs/heads/${branch}`

/** The ref record named `ref` in a repository. */
export function refOf(gh: GithubStore, repoId: number, ref: string) {
  return inRepo(gh.refs, repoId, (record) => record.ref === ref)
}

/** Points `ref` at `sha`, creating it if needed. */
export function setRef(gh: GithubStore, repoId: number, ref: string, sha: string): void {
  const existing = refOf(gh, repoId, ref)

  if (existing) gh.refs.update(existing.id, { sha })
  else gh.refs.insert({ repoId, ref, sha })
}

/** The commit a branch points at, if the branch exists. */
export function branchHead(
  gh: GithubStore,
  repoId: number,
  branch: string,
): GithubCommitRecord | undefined {
  const ref = refOf(gh, repoId, branchRef(branch))

  return ref && gh.commits.findOneBy("sha", ref.sha)
}

/** Every branch of a repository with its head sha, in creation order. */
export function branchesOf(gh: GithubStore, repoId: number) {
  return gh.refs
    .findBy("repoId", repoId)
    .filter((ref) => ref.ref.startsWith("refs/heads/"))
    .map((ref) => ({ name: ref.ref.slice("refs/heads/".length), sha: ref.sha }))
}

/**
 * A commit reference as GitHub resolves it: a full or abbreviated sha, a branch name or a
 * `refs/…` name.
 */
export function resolveCommit(gh: GithubStore, repoId: number, name: string) {
  const ref = refOf(gh, repoId, name) ?? refOf(gh, repoId, branchRef(name))
  const sha = ref?.sha ?? name

  return gh.commits
    .all()
    .find((commit) => commit.repoId === repoId && sha.length >= 7 && commit.sha.startsWith(sha))
}

function treeSha(tree: Record<string, string>): string {
  return sha1(
    Object.keys(tree)
      .toSorted()
      .map((path) => `${path} ${tree[path] ?? ""}`)
      .join("\n"),
  )
}

/** What a new commit records. */
export interface NewCommit {
  readonly tree: Record<string, string>
  readonly parents: readonly string[]
  readonly message: string
  readonly author: GitPerson
}

/** Stores a commit (not yet on any branch). */
export function writeCommit(gh: GithubStore, repoId: number, commit: NewCommit) {
  return gh.commits.insert({
    repoId,
    sha: sha1(`${commit.message}\n${commit.parents.join(",")}\n${randomBytes(16).toString("hex")}`),
    treeSha: treeSha(commit.tree),
    tree: { ...commit.tree },
    parents: [...commit.parents],
    message: commit.message,
    author: commit.author,
    committer: commit.author,
  })
}

/** A change to one path: new content, or `null` to delete it. */
export type FileChange = Readonly<Record<string, Buffer | null>>

/** The tree after applying `changes` to `tree`. */
export function changedTree(
  gh: GithubStore,
  tree: Record<string, string>,
  changes: FileChange,
): Record<string, string> {
  const next = { ...tree }

  for (const [path, content] of Object.entries(changes)) {
    if (content === null) delete next[path]
    else next[path] = putBlob(gh, content)
  }

  return next
}

/** What a branch moved from and to when a commit was added to it. */
export interface Push {
  readonly branch: string
  readonly before: string
  readonly commits: readonly GithubCommitRecord[]
}

/** Commits `changes` on top of a branch (an empty repository starts it) and moves the branch. */
export function commitTo(
  gh: GithubStore,
  repo: GithubRepoRecord,
  branch: string,
  change: { readonly files: FileChange; readonly message: string; readonly author: GitPerson },
): Push {
  const parent = branchHead(gh, repo.id, branch)
  const commit = writeCommit(gh, repo.id, {
    tree: changedTree(gh, parent?.tree ?? {}, change.files),
    parents: parent ? [parent.sha] : [],
    message: change.message,
    author: change.author,
  })

  setRef(gh, repo.id, branchRef(branch), commit.sha)

  return { branch, before: parent?.sha ?? "0".repeat(40), commits: [commit] }
}

/** Every commit reachable from `sha`, newest first. */
export function history(gh: GithubStore, sha: string): GithubCommitRecord[] {
  const seen = new Set<string>()
  const out: GithubCommitRecord[] = []
  const queue = [sha]

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const commit = seen.has(next) ? undefined : gh.commits.findOneBy("sha", next)

    seen.add(next)

    if (commit) {
      out.push(commit)
      queue.push(...commit.parents)
    }
  }

  return out
}

/** The newest commit both `a` and `b` can reach, if any. */
export function mergeBase(gh: GithubStore, a: string, b: string): GithubCommitRecord | undefined {
  const reachable = new Set(history(gh, b).map((commit) => commit.sha))

  return history(gh, a).find((commit) => reachable.has(commit.sha))
}

/** How one file differs between two trees. */
export interface FileDiff {
  readonly filename: string
  readonly status: "added" | "removed" | "modified"
  readonly sha: string | null
  readonly additions: number
  readonly deletions: number
}

const lineCount = (bytes: Buffer) => (bytes.length === 0 ? 0 : bytes.toString().split("\n").length)

function diffOne(
  gh: GithubStore,
  path: string,
  from: string | undefined,
  to: string | undefined,
): FileDiff {
  const removed = from === undefined ? 0 : lineCount(blobBytes(gh, from))
  const added = to === undefined ? 0 : lineCount(blobBytes(gh, to))
  const status = from === undefined ? "added" : to === undefined ? "removed" : "modified"

  return { filename: path, status, sha: to ?? null, additions: added, deletions: removed }
}

/** The files that differ between two trees, by path; a modified file counts all lines changed. */
export function diffTrees(
  gh: GithubStore,
  from: Record<string, string>,
  to: Record<string, string>,
): FileDiff[] {
  const paths = [...new Set([...Object.keys(from), ...Object.keys(to)])].toSorted()

  return paths
    .filter((path) => from[path] !== to[path])
    .map((path) => diffOne(gh, path, from[path], to[path]))
}
