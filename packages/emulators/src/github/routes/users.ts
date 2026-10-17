import type { components } from "@octokit/openapi-types"

import { requireUser } from "../auth.ts"
import type { GithubRouteContext } from "../context.ts"
import type { GithubAccount } from "../entities.ts"
import { privateUser, simpleUser } from "../formatters.ts"
import { GithubApiError, ghTime, notFound } from "../helpers.ts"
import type { GithubStore } from "../store.ts"

type Schemas = components["schemas"]

/** Anyone's public profile, as `GET /users/{username}` shows it. */
function publicUser(gh: GithubStore, account: GithubAccount) {
  const repos = gh.repos.findBy("owner", account.login).filter((repo) => !repo.private)

  return {
    ...simpleUser(account),
    name: account.name,
    company: account.company,
    blog: "",
    location: account.location,
    email: account.email,
    hireable: null,
    bio: account.bio,
    public_repos: repos.length,
    public_gists: 0,
    followers: 0,
    following: 0,
    created_at: ghTime(account.created_at),
    updated_at: ghTime(account.updated_at),
  } satisfies Schemas["public-user"]
}

/** The signed-in person and their email addresses, and anyone's public profile. */
export function userRoutes(context: GithubRouteContext): void {
  const { app } = context

  app.get("/user", (c) => c.json(privateUser(context.github(), requireUser(c, context).account)))

  app.get("/user/emails", (c) => {
    const caller = requireUser(c, context)
    const allowed =
      caller.app !== undefined
        ? caller.app.permissions.email_addresses !== undefined
        : caller.scopes.some((scope) => scope === "user" || scope === "user:email")

    if (!allowed) throw new GithubApiError(404, "Not Found")

    return c.json(caller.account.emails satisfies Schemas["email"][])
  })

  app.get("/users/:username", (c) => {
    const gh = context.github()
    const account = gh.accounts
      .all()
      .find((candidate) => candidate.login.toLowerCase() === c.req.param("username").toLowerCase())

    if (!account) throw notFound()

    return c.json(publicUser(gh, account))
  })
}
