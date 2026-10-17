import { oauthTables } from "../oauth/pkce.ts"
import type { Store } from "../store.ts"
import type {
  GithubAccount,
  GithubAppRecord,
  GithubBlobRecord,
  GithubCheckRunRecord,
  GithubCommentRecord,
  GithubCommitRecord,
  GithubHookRecord,
  GithubInstallationRecord,
  GithubInstallationTokenRecord,
  GithubIssueRecord,
  GithubLabelRecord,
  GithubPatRecord,
  GithubPullRecord,
  GithubRefRecord,
  GithubRepoRecord,
  GithubReviewRecord,
} from "./entities.ts"

/** The GitHub state held in an emulator's store. */
export function githubStore(store: Store) {
  return {
    accounts: store.collection<GithubAccount>("github.accounts", ["login", "ghId"]),
    repos: store.collection<GithubRepoRecord>("github.repos", ["owner", "ghId"]),
    ...gitTables(store),
    ...issueTables(store),
    ...appTables(store),
    ...oauthTables(store, "github"),
  }
}

/** Blobs, commits and refs: each repository's git history. */
function gitTables(store: Store) {
  return {
    blobs: store.collection<GithubBlobRecord>("github.blobs", ["sha"]),
    commits: store.collection<GithubCommitRecord>("github.commits", ["sha"]),
    refs: store.collection<GithubRefRecord>("github.refs", ["repoId"]),
  }
}

/** Issues, pull requests and what hangs off them. */
function issueTables(store: Store) {
  const byRepo = ["repoId"] as const

  return {
    labels: store.collection<GithubLabelRecord>("github.labels", byRepo),
    issues: store.collection<GithubIssueRecord>("github.issues", byRepo),
    comments: store.collection<GithubCommentRecord>("github.comments", ["ghId"]),
    pulls: store.collection<GithubPullRecord>("github.pulls", byRepo),
    reviews: store.collection<GithubReviewRecord>("github.reviews", byRepo),
    checkRuns: store.collection<GithubCheckRunRecord>("github.check_runs", ["ghId"]),
    hooks: store.collection<GithubHookRecord>("github.hooks", ["ghId"]),
  }
}

/** Apps, their installations and the credentials that act for them. */
function appTables(store: Store) {
  return {
    apps: store.collection<GithubAppRecord>("github.apps", ["clientId", "ghId"]),
    installations: store.collection<GithubInstallationRecord>("github.installations", ["ghId"]),
    installationTokens: store.collection<GithubInstallationTokenRecord>(
      "github.installation_tokens",
      ["token"],
    ),
    pats: store.collection<GithubPatRecord>("github.pats", ["token"]),
  }
}

export type GithubStore = ReturnType<typeof githubStore>
