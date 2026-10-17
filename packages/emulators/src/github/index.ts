import { defineEmulator } from "../define.ts"
import { restMiddleware } from "./api.ts"
import type { GithubRouteContext } from "./context.ts"
import { GithubEvents } from "./events.ts"
import { githubErrors } from "./helpers.ts"
import { appRoutes } from "./routes/apps.ts"
import { checkRoutes } from "./routes/checks.ts"
import { commentRoutes } from "./routes/comments.ts"
import { commitRoutes } from "./routes/commits.ts"
import { contentRoutes } from "./routes/contents.ts"
import { hookRoutes } from "./routes/hooks.ts"
import { issueRoutes } from "./routes/issues.ts"
import { labelRoutes } from "./routes/labels.ts"
import { oauthRoutes } from "./routes/oauth.ts"
import { pullRoutes } from "./routes/pulls.ts"
import { repoRoutes } from "./routes/repos.ts"
import { userRoutes } from "./routes/users.ts"
import { GITHUB_DELIVERY, githubEndpoints, githubWebhookHeaders } from "./signature.ts"
import { githubStore } from "./store.ts"

export { githubOutboundFaults } from "./faults.ts"
export { GITHUB_HOSTS } from "./helpers.ts"
export {
  githubAppKey,
  type GithubCheckRunView,
  type GithubCommentView,
  type GithubIssueView,
  githubRepo,
  type GithubRepoView,
  githubSignIns,
  installGithubApp,
  uninstallGithubApp,
} from "./inspect.ts"
export { type GithubSeedConfig, seedGithub } from "./seed.ts"

function routes(context: GithubRouteContext): void {
  /* Comment routes come before issue routes: `issues/comments` would otherwise read as issue "comments". */
  for (const register of [
    oauthRoutes,
    userRoutes,
    appRoutes,
    repoRoutes,
    commentRoutes,
    issueRoutes,
    labelRoutes,
    pullRoutes,
    contentRoutes,
    commitRoutes,
    checkRoutes,
    hookRoutes,
  ])
    register(context)
}

/**
 * GitHub on its real hostnames: OAuth sign-in on github.com for OAuth Apps and GitHub Apps, and
 * the REST API on api.github.com with GitHub App JWTs and installation tokens, repositories,
 * issues and comments, labels, pull requests and reviews, contents, commits, branches and refs,
 * check runs and repository webhooks. Webhooks to repository hooks and installed apps are signed
 * with `X-Hub-Signature-256` and go through the webhook dispatcher.
 */
export const github = defineEmulator({
  name: "github",
  setup({ app, store, clock, outbox }) {
    app.onError(githubErrors())
    app.use(restMiddleware(store, clock))
    routes({
      app,
      store,
      clock,
      github: () => githubStore(store),
      events: new GithubEvents(store, outbox),
    })
  },
  webhooks: ({ store }) => ({
    endpoints: () => githubEndpoints(store),
    sign: ({ endpoint, body }) => githubWebhookHeaders(endpoint, body),
    policy: GITHUB_DELIVERY,
  }),
})
