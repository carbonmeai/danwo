import type { ToolExecuteResponse, ToolProxyResponse } from "@composio/client/resources"

import type { Context } from "../../http.ts"
import { asRecord, isRecord } from "../../json.ts"
import { accountForCall } from "../accounts.ts"
import { backendFor } from "../backends/index.ts"
import type { ComposioRouteContext } from "../context.ts"
import type { ToolDefinition } from "../entities.ts"
import { execute } from "../execute.ts"
import { listedToolkit, toolkitObject, toolObject } from "../formatters.ts"
import {
  api,
  badRequest,
  ComposioError,
  jsonBody,
  notFound,
  page,
  queryFlag,
  queryList,
  textOf,
  toolkitKey,
} from "../helpers.ts"
import { allToolkits, allTools, toolkitOf, toolOf } from "../lookup.ts"

/** Whether a catalogue entry's name or description mentions `search`. */
function mentions(
  entry: { readonly name: string; readonly description: string },
  search: string | undefined,
): boolean {
  if (search === undefined) return true

  const needle = search.toLowerCase()

  return `${entry.name} ${entry.description}`.toLowerCase().includes(needle)
}

function toolsMatching(context: ComposioRouteContext, c: Context): ToolDefinition[] {
  const toolkit = c.req.query("toolkit_slug")
  const slugs = queryList(c, "tool_slugs").map((slug) => slug.toUpperCase())
  const tags = queryList(c, "tags")
  const search = textOf(c.req.query("search")) ?? textOf(c.req.query("query"))
  const important = queryFlag(c, "important")

  return allTools(context.objects).filter(
    (tool) =>
      (toolkit === undefined || tool.toolkit === toolkitKey(toolkit)) &&
      (slugs.length === 0 || slugs.includes(tool.slug)) &&
      tags.every((tag) => tool.tags?.includes(tag)) &&
      (!important || tool.tags?.includes("important")) &&
      mentions(tool, search),
  )
}

function toolNamed(context: ComposioRouteContext, slug: string): ToolDefinition {
  const tool = toolOf(context.objects, slug)

  if (!tool) throw notFound("Tool", slug, 1101, "Tool_ToolNotFound")

  return tool
}

/** `{ name, value, type }` header and query parameters of a proxied call, applied to its request. */
function proxiedRequest(
  url: URL,
  body: Record<string, unknown>,
  token: string | undefined,
): Request {
  const headers = new Headers({ accept: "application/json" })

  if (token !== undefined) headers.set("authorization", `Bearer ${token}`)

  for (const parameter of Array.isArray(body["parameters"]) ? body["parameters"] : []) {
    const { name, value, type } = asRecord(parameter) ?? {}

    if (typeof name !== "string") continue
    if (type === "header") headers.set(name, String(value))
    else url.searchParams.set(name, String(value))
  }

  const payload = body["body"]

  if (payload !== undefined) headers.set("content-type", "application/json")

  return new Request(url, {
    method: textOf(body["method"]) ?? "GET",
    headers,
    ...(payload !== undefined && { body: JSON.stringify(payload) }),
  })
}

/** `POST /tools/execute/proxy`: a raw call to the toolkit's API with the account's credentials. */
async function proxy(context: ComposioRouteContext, c: Context): Promise<Response> {
  const body = await jsonBody(c)
  const endpoint = textOf(body["endpoint"])

  if (endpoint === undefined) throw badRequest("endpoint is required")

  const accountId = textOf(body["connected_account_id"])
  const toolkit = accountId ? context.objects.accounts.get(accountId)?.toolkit : undefined

  if (toolkit === undefined) throw badRequest("connected_account_id must name a connected account")

  const account = accountForCall(context.objects, toolkit, { accountId })
  const connected = backendFor(context.store, toolkit)

  if (!connected)
    throw new ComposioError(
      501,
      1102,
      "Tool_ProxyNotAvailable",
      `No backend emulator answers ${toolkit}`,
    )

  const base = connected.backend.apiBase(toolkit).replace(/\/+$/, "")
  const url = new URL(
    /^https?:\/\//.test(endpoint) ? endpoint : `${base}/${endpoint.replace(/^\/+/, "")}`,
  )
  const token =
    typeof account.val["access_token"] === "string" ? account.val["access_token"] : undefined
  const response = await connected.emulator.fetch(proxiedRequest(url, body, token))
  const text = await response.text()
  let data: unknown = text

  try {
    data = text === "" ? null : JSON.parse(text)
  } catch {
    /* Not JSON: the text as it came. */
  }

  return c.json({
    data,
    status: response.status,
    headers: Object.fromEntries(response.headers),
  } satisfies ToolProxyResponse)
}

async function executeTool(context: ComposioRouteContext, c: Context): Promise<Response> {
  const tool = toolNamed(context, c.req.param("slug"))
  const body = await jsonBody(c)
  const args = isRecord(body["arguments"]) ? body["arguments"] : {}
  const answer = await execute(context, tool, args, {
    accountId: textOf(body["connected_account_id"]),
    userId: textOf(body["user_id"]) ?? textOf(body["entity_id"]),
  })

  return c.json({
    data: isRecord(answer.data) ? answer.data : { result: answer.data },
    error: answer.error,
    successful: answer.successful,
    log_id: answer.logId,
  } satisfies ToolExecuteResponse)
}

/** The catalogue: toolkits and tools, listed, read and run. */
export function toolRoutes(context: ComposioRouteContext): void {
  const { objects } = context
  const routes = api(context.app)

  routes.get("/toolkits", (c) => {
    const category = c.req.query("category")
    const search = textOf(c.req.query("search"))
    const toolkits = allToolkits(objects).filter(
      (toolkit) =>
        (category === undefined || toolkit.categories.includes(category)) &&
        mentions(toolkit, search),
    )

    return c.json(
      page(
        c,
        toolkits.map((toolkit) => listedToolkit(toolkit, objects)),
      ),
    )
  })
  routes.get("/toolkits/:slug", (c) => {
    const toolkit = toolkitOf(objects, c.req.param("slug"))

    if (!toolkit) throw notFound("Toolkit", c.req.param("slug"), 1201, "Toolkit_NotFound")

    return c.json(toolkitObject(toolkit, objects))
  })
  routes.get("/tools", (c) =>
    c.json(
      page(
        c,
        toolsMatching(context, c).map((tool) => toolObject(tool, objects)),
      ),
    ),
  )
  routes.get("/tools/enum", (c) => c.json(allTools(objects).map((tool) => tool.slug)))
  routes.get("/tools/:slug", (c) =>
    c.json(toolObject(toolNamed(context, c.req.param("slug")), objects)),
  )
  routes.post("/tools/execute/proxy", (c) => proxy(context, c))
  routes.post("/tools/execute/:slug", (c) => executeTool(context, c))
}
