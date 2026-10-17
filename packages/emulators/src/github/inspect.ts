import type { Emulator } from "../define.ts"
import { type SignIns, signIns } from "../oauth/sign-ins.ts"
import { findRepo } from "./auth.ts"
import type { GithubCheckRunRecord, GithubRepoRecord } from "./entities.ts"
import { GithubEvents } from "./events.ts"
import { blobBytes, branchHead, history } from "./git.ts"
import { addInstallation, type GithubSeedInstallation } from "./seed.ts"
import { githubStore, type GithubStore } from "./store.ts"

/** An issue or pull request as a test reads it. */
export interface GithubIssueView {
  readonly number: number
  readonly title: string
  readonly body: string | null
  readonly state: "open" | "closed"
  readonly labels: readonly string[]
  readonly author: string
  readonly isPull: boolean
}

/** A comment as a test reads it. */
export interface GithubCommentView {
  readonly id: number
  readonly issue: number
  readonly body: string
  readonly author: string
}

/** A check run as a test reads it. */
export type GithubCheckRunView = Pick<
  GithubCheckRunRecord,
  "name" | "headSha" | "status" | "conclusion" | "title" | "summary" | "annotations"
> & { readonly id: number }

/** What a test can read from one repository. */
export interface GithubRepoView {
  /** Issues and pull requests, oldest first. */
  issues(): GithubIssueView[]
  /** Comments, oldest first; only those on issue `number` when given. */
  comments(number?: number): GithubCommentView[]
  /** Check runs, oldest first; only those for commit `sha` when given. */
  checkRuns(sha?: string): GithubCheckRunView[]
  /** A file's text on a branch (the default branch without one). */
  file(path: string, branch?: string): string | undefined
  /** Commit messages on a branch, newest first. */
  commits(branch?: string): string[]
}

function requireRepo(gh: GithubStore, fullName: string): GithubRepoRecord {
  const [owner = "", name = ""] = fullName.split("/")
  const repo = findRepo(gh, owner, name)

  if (!repo) throw new Error(`no repository ${fullName} in the GitHub emulator`)

  return repo
}

/** Reads a repository's issues, comments, check runs and files from a GitHub emulator. */
export function githubRepo(emulator: Pick<Emulator, "store">, fullName: string): GithubRepoView {
  const gh = () => githubStore(emulator.store)
  const repo = () => requireRepo(gh(), fullName)

  return {
    issues: () =>
      gh()
        .issues.findBy("repoId", repo().id)
        .map(({ number, title, body, state, labels, author, isPull }) => ({
          number,
          title,
          body,
          state,
          labels,
          author,
          isPull,
        })),
    comments: (number) =>
      gh()
        .comments.all()
        .filter(
          (comment) =>
            comment.repoId === repo().id &&
            (number === undefined || comment.issueNumber === number),
        )
        .map((comment) => ({
          id: comment.ghId,
          issue: comment.issueNumber,
          body: comment.body,
          author: comment.author,
        })),
    checkRuns: (sha) =>
      gh()
        .checkRuns.all()
        .filter((run) => run.repoId === repo().id && (sha === undefined || run.headSha === sha))
        .map(({ ghId, name, headSha, status, conclusion, title, summary, annotations }) => ({
          id: ghId,
          name,
          headSha,
          status,
          conclusion,
          title,
          summary,
          annotations,
        })),
    file: (path, branch) => {
      const head = branchHead(gh(), repo().id, branch ?? repo().defaultBranch)
      const sha = head?.tree[path]

      return sha === undefined ? undefined : blobBytes(gh(), sha).toString()
    },
    commits: (branch) => {
      const head = branchHead(gh(), repo().id, branch ?? repo().defaultBranch)

      return head ? history(gh(), head.sha).map((commit) => commit.message) : []
    },
  }
}

/** Who signed in to which OAuth App or GitHub App, for tests. */
export function githubSignIns(emulator: Pick<Emulator, "store">): SignIns {
  return signIns(
    () => githubStore(emulator.store),
    (login) => githubStore(emulator.store).accounts.findOneBy("login", login)?.emails[0]?.email,
  )
}

/** The private key (PEM) of a seeded GitHub App, for signing its JWTs. */
export function githubAppKey(emulator: Pick<Emulator, "store">, slug: string): string {
  const app = githubStore(emulator.store)
    .apps.all()
    .find((candidate) => candidate.slug === slug)

  if (!app) throw new Error(`no GitHub App ${slug} in the GitHub emulator`)

  return app.privateKey
}

/**
 * Installs a seeded app on an account, as a person would on github.com, and sends the app its
 * `installation` `created` webhook. Returns the installation id.
 */
export function installGithubApp(
  emulator: Pick<Emulator, "store" | "outbox">,
  installation: GithubSeedInstallation,
): number {
  const record = addInstallation(emulator.store, installation)

  new GithubEvents(emulator.store, emulator.outbox).installation("created", record)

  return record.ghId
}

/** Removes an installation and sends the app its `installation` `deleted` webhook. */
export function uninstallGithubApp(
  emulator: Pick<Emulator, "store" | "outbox">,
  installationId: number,
): void {
  const gh = githubStore(emulator.store)
  const record = gh.installations.findOneBy("ghId", installationId)

  if (!record) throw new Error(`no installation ${installationId} in the GitHub emulator`)

  new GithubEvents(emulator.store, emulator.outbox).installation("deleted", record)
  gh.installations.delete(record.id)
  for (const token of gh.installationTokens.findBy("installationId", installationId))
    gh.installationTokens.delete(token.id)
}
