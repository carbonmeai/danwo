import type { GithubRouteContext } from "./context.ts"
import type { GithubRepoRecord } from "./entities.ts"
import type { Push } from "./git.ts"

/**
 * What follows a push to a branch: the `push` event, and `pull_request` `synchronize` for every
 * open pull request whose head is that branch.
 */
export function announcePush(
  context: GithubRouteContext,
  repo: GithubRepoRecord,
  push: Push,
  actor: string,
): void {
  const gh = context.github()

  context.events.push(repo, push, actor)

  for (const pull of gh.pulls.findBy("repoId", repo.id)) {
    const issue = gh.issues.findBy("repoId", repo.id).find((i) => i.number === pull.number)

    if (pull.head === push.branch && issue?.state === "open")
      context.events.pull("synchronize", repo, { pull, issue }, actor)
  }
}
