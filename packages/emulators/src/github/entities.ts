import type { Entity } from "../store.ts"

/**
 * GitHub's state, as the emulator stores it. Records are built from small groups of fields; the
 * API's own shapes are made from them in the formatters.
 */

/** An object with the id GitHub's API shows, from the one sequence all objects share. */
interface Numbered extends Entity {
  ghId: number
}

/** An object that belongs to one repository, by the repository's store id. */
interface InRepo extends Numbered {
  repoId: number
}

/** What a person or organisation shows on its profile. */
interface Profile {
  email: string | null
  emails: GithubEmail[]
  company: string | null
  location: string | null
  bio: string | null
}

/** A person or organisation. `email` is the public address; `members` is empty for users. */
export interface GithubAccount extends Numbered, Profile {
  login: string
  type: "User" | "Organization"
  name: string | null
  members: string[]
}

interface GithubEmail {
  email: string
  primary: boolean
  verified: boolean
  visibility: "public" | "private" | null
}

/** What a repository says about itself. */
interface RepoAbout {
  description: string | null
  homepage: string | null
  archived: boolean
  topics: string[]
}

/** A repository; issues and pull requests share its `nextNumber` sequence. */
export interface GithubRepoRecord extends Numbered, RepoAbout {
  owner: string
  name: string
  private: boolean
  defaultBranch: string
  nextNumber: number
}

/** A file's content (base64), addressed by its git blob sha. */
export interface GithubBlobRecord extends Entity {
  sha: string
  content: string
  size: number
}

export interface GitPerson {
  name: string
  email: string
  date: string
}

/** A git object of one repository: a commit or a ref, with the sha it is or points at. */
interface GitObject extends Entity {
  repoId: number
  sha: string
}

/** Who made a commit, and why. */
interface CommitHeader {
  message: string
  author: GitPerson
  committer: GitPerson
}

/** A commit, with its whole tree as a map from path to blob sha. */
export interface GithubCommitRecord extends GitObject, CommitHeader {
  tree: Record<string, string>
  treeSha: string
  parents: string[]
}

/** A git ref such as `refs/heads/main`. */
export interface GithubRefRecord extends GitObject {
  ref: string
}

export interface GithubLabelRecord extends InRepo {
  name: string
  color: string
  description: string | null
}

/** An issue's text and who wrote it. */
interface IssueText {
  title: string
  body: string | null
  author: string
}

/** Whether an issue is open, and how and when it was closed. */
interface IssueState {
  state: "open" | "closed"
  stateReason: "completed" | "not_planned" | "reopened" | null
  closedAt: string | null
  locked: boolean
}

/** An issue or a pull request; a pull request also has a `GithubPullRecord`. */
export interface GithubIssueRecord extends InRepo, IssueText, IssueState {
  number: number
  labels: string[]
  assignees: string[]
  isPull: boolean
  comments: number
}

export interface GithubCommentRecord extends InRepo {
  issueNumber: number
  body: string
  author: string
}

/** How a pull request was merged, once it was. */
interface PullMerge {
  merged: boolean
  mergedAt: string | null
  mergedBy: string | null
  mergeSha: string | null
}

/** A pull request's branches; `baseSha` is the base's head when it was opened or retargeted. */
export interface GithubPullRecord extends InRepo, PullMerge {
  number: number
  head: string
  base: string
  baseSha: string
  draft: boolean
}

export interface GithubReviewRecord extends InRepo {
  pullNumber: number
  author: string
  body: string
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING"
  commitSha: string
}

/** The lines of a file an annotation is on. */
interface AnnotationPlace {
  path: string
  start_line: number
  end_line: number
}

/** One annotation of a check run, as the Checks API takes it. */
export interface CheckAnnotation extends AnnotationPlace {
  annotation_level: "notice" | "warning" | "failure"
  message: string
  title: string | null
  raw_details: string | null
}

type CheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"

/** Where a check run is in its life. */
interface CheckProgress {
  status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending"
  conclusion: CheckConclusion | null
  startedAt: string | null
  completedAt: string | null
}

/** What a check run reports. */
interface CheckOutput {
  title: string | null
  summary: string | null
  text: string | null
  annotations: CheckAnnotation[]
}

/** A check run, by the app (`appId`) that created it. */
export interface GithubCheckRunRecord extends InRepo, CheckProgress, CheckOutput {
  appId: number
  name: string
  headSha: string
  externalId: string | null
  detailsUrl: string | null
}

/** A repository webhook. */
export interface GithubHookRecord extends InRepo {
  url: string
  secret: string
  contentType: "json" | "form"
  events: string[]
  active: boolean
}

/** What an app is and who owns it. */
interface AppIdentity {
  kind: "github-app" | "oauth-app"
  slug: string
  name: string
  owner: string
}

/**
 * How an app signs in: its OAuth client, and for a GitHub App its private key (PEM; empty for
 * OAuth Apps) and whether user tokens expire after eight hours with a refresh token.
 */
interface AppCredentials {
  clientId: string
  clientSecret: string
  callbackUrls: string[]
  privateKey: string
  expiringUserTokens: boolean
}

/** Where a GitHub App's webhooks go, and what it may do and hear about. */
interface AppReach {
  webhookUrl: string | null
  webhookSecret: string
  permissions: Record<string, string>
  events: string[]
}

/** A GitHub App or an OAuth App: both sign users in; only a GitHub App has installations. */
export type GithubAppRecord = Numbered & AppIdentity & AppCredentials & AppReach

/** An app on an account; `repoIds` lists a `selected` installation's repositories. */
export interface GithubInstallationRecord extends Numbered {
  appId: number
  account: string
  repositorySelection: "all" | "selected"
  repoIds: number[]
  suspended: boolean
}

/** A token issued to an installation; it may be limited to some repositories and permissions. */
export interface GithubInstallationTokenRecord extends Entity {
  token: string
  installationId: number
  repoIds: number[] | null
  permissions: Record<string, string>
  expiresAt: string
}

/** A personal access token (classic), seeded for tests. */
export interface GithubPatRecord extends Entity {
  token: string
  login: string
  scopes: string[]
}
