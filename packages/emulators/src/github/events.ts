import type { components } from "@octokit/openapi-webhooks-types"

import type { Outbox } from "../outbox.ts"
import type { Store } from "../store.ts"
import { installationRepos } from "./auth.ts"
import type {
  GithubAppRecord,
  GithubCheckRunRecord,
  GithubCommentRecord,
  GithubHookRecord,
  GithubInstallationRecord,
  GithubIssueRecord,
  GithubPullRecord,
  GithubRepoRecord,
  GithubReviewRecord,
} from "./entities.ts"
import { installationObject, repositoryObject, userByLogin } from "./formatters.ts"
import { checkRunObject, hookObject } from "./git-format.ts"
import type { Push } from "./git.ts"
import { nodeId, WEB } from "./helpers.ts"
import {
  commentObject,
  issueObject,
  labelObject,
  pullObject,
  reviewObject,
} from "./issue-format.ts"
import { githubStore } from "./store.ts"

type Webhooks = components["schemas"]

/**
 * GitHub's webhook topics, as the outbox carries them: a repository hook gets
 * `<event>@<owner>/<repo>`, an app gets `<event>#<app-slug>` (with its installation in the
 * payload), and a hook's ping is `ping@hook:<id>`. The delivery side turns the topic back into
 * the `X-GitHub-Event` header.
 */
export const hookTopic = (event: string, fullName: string) => `${event}@${fullName}`

export const appTopic = (event: string, app: GithubAppRecord) => `${event}#${app.slug}`

export const pingTopic = (hookId: number) => `ping@hook:${hookId}`

/** Whether a hook or an app's subscription list includes `event`. */
const subscribes = (events: readonly string[], event: string) =>
  events.includes(event) || events.includes("*")

type IssueAction = "opened" | "edited" | "closed" | "reopened" | "labeled" | "unlabeled"
type PullAction = "opened" | "edited" | "closed" | "reopened" | "synchronize"

/** Queues GitHub's webhook events for repository hooks and installed apps. */
export class GithubEvents {
  private readonly store: Store
  private readonly outbox: Outbox

  constructor(store: Store, outbox: Outbox) {
    this.store = store
    this.outbox = outbox
  }

  private get gh() {
    return githubStore(this.store)
  }

  /** The apps installed on `repo` that subscribe to `event` and have a webhook URL. */
  private appsFor(repo: GithubRepoRecord, event: string) {
    const gh = this.gh

    return gh.installations.all().flatMap((installation) => {
      const app = gh.apps.findOneBy("ghId", installation.appId)
      const covers = installationRepos(gh, installation).some((r) => r.id === repo.id)
      const wanted = app?.webhookUrl && covers && !installation.suspended

      return wanted && subscribes(app.events, event) ? [{ app, installation }] : []
    })
  }

  /** Sends a repository event to the repository's hooks and to every app installed on it. */
  private repoEvent(event: string, repo: GithubRepoRecord, payload: Record<string, unknown>) {
    const hooked = this.gh.hooks
      .all()
      .some((hook) => hook.repoId === repo.id && hook.active && subscribes(hook.events, event))

    if (hooked) this.outbox.push(hookTopic(event, `${repo.owner}/${repo.name}`), payload)

    for (const { app, installation } of this.appsFor(repo, event))
      this.outbox.push(appTopic(event, app), {
        ...payload,
        installation: { id: installation.ghId, node_id: nodeId("MDIz", installation.ghId) },
      })
  }

  /** The repository and sender every repository event carries. */
  private base(repo: GithubRepoRecord, sender: string) {
    const gh = this.gh

    return {
      repository: repositoryObject(gh, repo),
      sender: userByLogin(gh, sender),
    } satisfies Pick<Webhooks["webhook-issues-opened"], "repository" | "sender">
  }

  issue(
    action: IssueAction,
    repo: GithubRepoRecord,
    issue: GithubIssueRecord,
    sender: string,
    label?: string,
  ): void {
    const gh = this.gh
    const found = gh.labels.findBy("repoId", repo.id).find((l) => l.name === label)

    this.repoEvent("issues", repo, {
      action,
      issue: issueObject(gh, repo, issue) satisfies Webhooks["webhooks_issue"],
      ...(found && { label: labelObject(repo, found) }),
      ...this.base(repo, sender),
    })
  }

  comment(
    action: "created" | "edited" | "deleted",
    repo: GithubRepoRecord,
    found: { readonly issue: GithubIssueRecord; readonly comment: GithubCommentRecord },
    sender: string,
  ): void {
    const gh = this.gh

    this.repoEvent("issue_comment", repo, {
      action,
      issue: issueObject(gh, repo, found.issue),
      comment: commentObject(gh, repo, found.comment) satisfies Webhooks["webhooks_issue_comment"],
      ...this.base(repo, sender),
    })
  }

  pull(
    action: PullAction,
    repo: GithubRepoRecord,
    found: { readonly pull: GithubPullRecord; readonly issue: GithubIssueRecord },
    sender: string,
  ): void {
    this.repoEvent("pull_request", repo, {
      action,
      number: found.pull.number,
      pull_request: pullObject(this.gh, repo, found.pull, found.issue),
      ...this.base(repo, sender),
    })
  }

  review(
    repo: GithubRepoRecord,
    review: GithubReviewRecord,
    found: { readonly pull: GithubPullRecord; readonly issue: GithubIssueRecord },
  ): void {
    const gh = this.gh

    this.repoEvent("pull_request_review", repo, {
      action: "submitted",
      review: reviewObject(gh, repo, review),
      pull_request: pullObject(gh, repo, found.pull, found.issue),
      ...this.base(repo, review.author),
    })
  }

  checkRun(
    action: "created" | "completed",
    repo: GithubRepoRecord,
    run: GithubCheckRunRecord,
    sender: string,
  ): void {
    this.repoEvent("check_run", repo, {
      action,
      check_run: checkRunObject(this.gh, repo, run),
      ...this.base(repo, sender),
    })
  }

  /** A push of commits to a branch. */
  push(repo: GithubRepoRecord, push: Push, pusher: string): void {
    const full = `${repo.owner}/${repo.name}`
    const after = push.commits.at(-1)?.sha ?? push.before
    const commits = push.commits.map((commit) => ({
      id: commit.sha,
      tree_id: commit.treeSha,
      distinct: true,
      message: commit.message,
      timestamp: commit.author.date,
      url: `${WEB}/${full}/commit/${commit.sha}`,
      author: { name: commit.author.name, email: commit.author.email },
      committer: { name: commit.committer.name, email: commit.committer.email },
      added: [],
      removed: [],
      modified: [],
    }))

    this.repoEvent("push", repo, {
      ref: `refs/heads/${push.branch}`,
      before: push.before,
      after,
      created: /^0+$/.test(push.before),
      deleted: false,
      forced: false,
      base_ref: null,
      compare: `${WEB}/${full}/compare/${push.before.slice(0, 12)}...${after.slice(0, 12)}`,
      commits,
      head_commit: commits.at(-1) ?? null,
      pusher: { name: pusher, email: null },
      ...this.base(repo, pusher),
    } satisfies Omit<Webhooks["webhook-push"], "repository" | "sender">)
  }

  /** A new hook's ping, sent only to that hook. */
  ping(repo: GithubRepoRecord, hook: GithubHookRecord, sender: string): void {
    this.outbox.push(pingTopic(hook.ghId), {
      zen: "Design for failure.",
      hook_id: hook.ghId,
      hook: hookObject(repo, hook),
      ...this.base(repo, sender),
    })
  }

  /** An app was installed on or removed from an account. */
  installation(action: "created" | "deleted", installation: GithubInstallationRecord): void {
    const gh = this.gh
    const app = gh.apps.findOneBy("ghId", installation.appId)

    if (!app?.webhookUrl) return

    this.outbox.push(appTopic("installation", app), {
      action,
      installation: installationObject(gh, installation),
      repositories: installationRepos(gh, installation).map((repo) => ({
        id: repo.ghId,
        node_id: nodeId("R", repo.ghId),
        name: repo.name,
        full_name: `${repo.owner}/${repo.name}`,
        private: repo.private,
      })),
      sender: userByLogin(gh, installation.account),
    })
  }
}
