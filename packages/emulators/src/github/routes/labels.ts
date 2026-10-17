import type { Context } from "../../http.ts"
import { repoAccess } from "../auth.ts"
import type { GithubRouteContext } from "../context.ts"
import type { GithubLabelRecord, GithubRepoRecord } from "../entities.ts"
import {
  bodyOf,
  inRepo,
  invalid,
  missingField,
  nextGhId,
  notFound,
  paged,
  stringField,
} from "../helpers.ts"
import { labelObject } from "../issue-format.ts"
import type { GithubStore } from "../store.ts"

const READ = { permission: "issues", write: false } as const
const WRITE = { permission: "issues", write: true } as const

function requireLabel(gh: GithubStore, repo: GithubRepoRecord, name: string): GithubLabelRecord {
  const label = inRepo(gh.labels, repo.id, (row) => row.name.toLowerCase() === name.toLowerCase())

  if (!label) throw notFound()

  return label
}

/** A label color: six hex digits, with or without `#`. */
function colorOf(body: Record<string, unknown>, fallback: string): string {
  const color = (stringField(body, "color") ?? fallback).replace(/^#/, "")

  if (!/^[0-9a-f]{6}$/i.test(color))
    throw invalid([{ resource: "Label", field: "color", code: "invalid" }])

  return color.toLowerCase()
}

async function createLabel(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo } = repoAccess(c, context, WRITE)
  const body = await bodyOf(c)
  const name = stringField(body, "name")

  if (!name) throw missingField("Label", "name")
  if (
    gh.labels
      .findBy("repoId", repo.id)
      .some((label) => label.name.toLowerCase() === name.toLowerCase())
  )
    throw invalid([{ resource: "Label", field: "name", code: "already_exists" }])

  const label = gh.labels.insert({
    ghId: nextGhId(context.store),
    repoId: repo.id,
    name,
    color: colorOf(body, "ededed"),
    description: stringField(body, "description") ?? null,
  })

  return c.json(labelObject(repo, label), 201)
}

async function updateLabel(c: Context, context: GithubRouteContext): Promise<Response> {
  const { gh, repo } = repoAccess(c, context, WRITE)
  const label = requireLabel(gh, repo, c.req.param("name"))
  const body = await bodyOf(c)
  const name = stringField(body, "new_name") ?? label.name
  const updated =
    gh.labels.update(label.id, {
      name,
      color: colorOf(body, label.color),
      description:
        "description" in body ? (stringField(body, "description") ?? null) : label.description,
    }) ?? label

  if (name !== label.name)
    for (const issue of gh.issues
      .findBy("repoId", repo.id)
      .filter((i) => i.labels.includes(label.name)))
      gh.issues.update(issue.id, { labels: issue.labels.map((l) => (l === label.name ? name : l)) })

  return c.json(labelObject(repo, updated))
}

/** A repository's labels. */
export function labelRoutes(context: GithubRouteContext): void {
  const { app } = context
  const path = "/repos/:owner/:repo/labels"

  app.get(path, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)

    return c.json(
      paged(c, gh.labels.findBy("repoId", repo.id)).map((label) => labelObject(repo, label)),
    )
  })
  app.post(path, (c) => createLabel(c, context))
  app.get(`${path}/:name`, (c) => {
    const { gh, repo } = repoAccess(c, context, READ)

    return c.json(labelObject(repo, requireLabel(gh, repo, c.req.param("name"))))
  })
  app.patch(`${path}/:name`, (c) => updateLabel(c, context))
  app.delete(`${path}/:name`, (c) => {
    const { gh, repo } = repoAccess(c, context, WRITE)
    const label = requireLabel(gh, repo, c.req.param("name"))

    gh.labels.delete(label.id)
    for (const issue of gh.issues
      .findBy("repoId", repo.id)
      .filter((i) => i.labels.includes(label.name)))
      gh.issues.update(issue.id, { labels: issue.labels.filter((l) => l !== label.name) })

    return c.body(null, 204)
  })
}
