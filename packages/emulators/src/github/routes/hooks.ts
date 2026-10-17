import type { Context } from "../../http.ts"
import { repoAccess } from "../auth.ts"
import type { GithubRouteContext } from "../context.ts"
import type { GithubHookRecord, GithubRepoRecord } from "../entities.ts"
import { hookObject } from "../git-format.ts"
import {
  bodyOf,
  invalid,
  nextGhId,
  notFound,
  paged,
  recordOf,
  stringField,
  stringsField,
} from "../helpers.ts"
import type { GithubStore } from "../store.ts"

const READ = { permission: "repository_hooks", write: false } as const
const WRITE = { permission: "repository_hooks", write: true } as const

function requireHook(gh: GithubStore, repo: GithubRepoRecord, id: number): GithubHookRecord {
  const hook = gh.hooks.findOneBy("ghId", id)

  if (!hook || hook.repoId !== repo.id) throw notFound()

  return hook
}

/** The `config` object of a hook request, as a record. */
const configOf = (body: Record<string, unknown>) => recordOf(body.config)

async function createHook(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo, actor } = repoAccess(c, context, WRITE)
  const body = await bodyOf(c)
  const config = configOf(body)
  const url = stringField(config, "url")

  if (!url)
    throw invalid([
      {
        resource: "Hook",
        field: "config",
        code: "custom",
        message: "Config must contain URL for webhooks",
      },
    ])

  const hook = gh.hooks.insert({
    ghId: nextGhId(context.store),
    repoId: repo.id,
    url,
    secret: stringField(config, "secret") ?? "",
    contentType: stringField(config, "content_type") === "form" ? "form" : "json",
    events: stringsField(body, "events") ?? ["push"],
    active: body.active !== false,
  })

  context.events.ping(repo, hook, actor)

  return c.json(hookObject(repo, hook), 201)
}

async function updateHook(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo } = repoAccess(c, context, WRITE)
  const hook = requireHook(gh, repo, Number(c.req.param("id")))
  const body = await bodyOf(c)
  const config = configOf(body)
  const events = stringsField(body, "events") ?? hook.events
  const add = stringsField(body, "add_events") ?? []
  const remove = stringsField(body, "remove_events") ?? []
  const updated =
    gh.hooks.update(hook.id, {
      url: stringField(config, "url") ?? hook.url,
      secret: stringField(config, "secret") ?? hook.secret,
      events: [...new Set([...events, ...add])].filter((event) => !remove.includes(event)),
      active: typeof body.active === "boolean" ? body.active : hook.active,
    }) ?? hook

  return c.json(hookObject(repo, updated))
}

/** Repository webhooks: the hooks list, creating one (which sends it a ping), and changing it. */
export function hookRoutes(context: GithubRouteContext): void {
  const { app } = context
  const path = "/repos/:owner/:repo/hooks"

  app.get(path, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)

    return c.json(
      paged(
        c,
        gh.hooks.all().filter((hook) => hook.repoId === repo.id),
      ).map((hook) => hookObject(repo, hook)),
    )
  })
  app.post(path, (c) => createHook(c, context))
  app.get(`${path}/:id`, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)

    return c.json(hookObject(repo, requireHook(gh, repo, Number(c.req.param("id")))))
  })
  app.patch(`${path}/:id`, (c) => updateHook(c, context))
  app.delete(`${path}/:id`, (c) => {
    const { gh, repo } = repoAccess(c, context, WRITE)

    gh.hooks.delete(requireHook(gh, repo, Number(c.req.param("id"))).id)

    return c.body(null, 204)
  })
  app.post(`${path}/:id/pings`, (c) => {
    const { gh, repo, actor } = repoAccess(c, context, WRITE)

    context.events.ping(repo, requireHook(gh, repo, Number(c.req.param("id"))), actor)

    return c.body(null, 204)
  })
}
