/**
 * Tiptap Cloud's document REST API on `<appId>.collab.tiptap.cloud/api`: list documents, read one
 * as ProseMirror JSON or as a Yjs update, create one from either, replace its content with JSON
 * (editors still connected receive the change), and delete it.
 */
import { HttpError } from "../errors.ts"
import type { App, Context } from "../http.ts"
import type { Store } from "../store.ts"
import { appTable, DEFAULT_FRAGMENT, type TiptapApp, type TiptapDocuments } from "./documents.ts"
import { proseMirrorNodeOf } from "./prosemirror.ts"

export interface TiptapRouteContext {
  readonly app: App
  readonly store: Store
  readonly documents: TiptapDocuments
}

/** The app a request's host names, after checking its API key. */
function authorised(ctx: TiptapRouteContext, c: Context): TiptapApp | undefined {
  const appId = /^([^.]+)\.collab\.tiptap\.cloud$/.exec(new URL(c.req.url).hostname)?.[1]
  const apps = appTable(ctx.store)
  const app = (appId === undefined ? undefined : apps.get(appId)) ?? apps.all()[0]

  if (
    app?.api_key !== null &&
    app?.api_key !== undefined &&
    c.req.header("authorization") !== app.api_key
  )
    throw new HttpError(401, "Unauthorized")

  return app
}

function formatOf(c: Context): "json" | "yjs" {
  const format = c.req.query("format")

  if (format !== undefined && format !== "json" && format !== "yjs")
    throw new HttpError(400, `Unknown format ${format}, use json or yjs`)

  return format ?? "json"
}

/** The ProseMirror document a JSON body holds. */
async function jsonBody(c: Context) {
  let parsed: unknown

  try {
    parsed = JSON.parse(await c.req.text())
  } catch {
    throw new HttpError(400, "The body is not valid JSON")
  }

  const doc = proseMirrorNodeOf(parsed)

  if (doc === undefined) throw new HttpError(400, "The body is not a ProseMirror document")

  return doc
}

async function isJson(c: Context): Promise<boolean> {
  try {
    JSON.parse(await c.req.text())

    return true
  } catch {
    return false
  }
}

/** Writes a request's body into a document: a Yjs update, or a ProseMirror JSON document. */
async function write(documents: TiptapDocuments, c: Context, name: string, yjs: boolean) {
  if (yjs) documents.applyUpdate(name, new Uint8Array(await c.req.arrayBuffer()), "rest")
  else documents.replace(name, await jsonBody(c), c.req.query("fragment") ?? DEFAULT_FRAGMENT)
}

function existing(ctx: TiptapRouteContext, name: string): void {
  if (!ctx.documents.has(name)) throw new HttpError(404, `Document ${name} not found`)
}

export function tiptapRoutes(ctx: TiptapRouteContext): void {
  const { app: router, documents } = ctx

  router.get("/api/documents", (c) => {
    authorised(ctx, c)

    return c.json(
      documents.list().map((doc) => ({
        name: doc.id,
        created_at: doc.created,
        updated_at: doc.changed,
        size: doc.size,
      })),
    )
  })

  router.get("/api/documents/:name", (c) => {
    authorised(ctx, c)

    const name = c.req.param("name")

    existing(ctx, name)

    if (formatOf(c) === "yjs")
      return c.body(Buffer.from(documents.update(name)), 200, {
        "content-type": "application/octet-stream",
      })

    return c.json(documents.json(name, c.req.query("fragment") ?? DEFAULT_FRAGMENT))
  })

  router.post("/api/documents/:name", async (c) => {
    authorised(ctx, c)

    const name = c.req.param("name")

    if (documents.has(name)) throw new HttpError(409, `Document ${name} already exists`)

    /* A body that is not JSON is a Yjs update, as a duplicate posts what a `yjs` read returned. */
    await write(documents, c, name, formatOf(c) === "yjs" || !(await isJson(c)))

    return c.body(null, 204)
  })

  router.patch("/api/documents/:name", async (c) => {
    authorised(ctx, c)

    const name = c.req.param("name")

    existing(ctx, name)

    await write(documents, c, name, formatOf(c) === "yjs")

    return c.body(null, 204)
  })

  router.delete("/api/documents/:name", (c) => {
    authorised(ctx, c)

    const name = c.req.param("name")

    existing(ctx, name)
    documents.remove(name)

    return c.body(null, 204)
  })
}
