import type {
  AuthConfigCreateResponse,
  AuthConfigDeleteResponse,
  AuthConfigUpdateResponse,
  AuthConfigUpdateStatusResponse,
} from "@composio/client/resources"

import type { Context } from "../../http.ts"
import { asRecord, isOneOf } from "../../json.ts"
import { authConfigOf } from "../accounts.ts"
import type { ComposioRouteContext } from "../context.ts"
import {
  AUTH_SCHEMES,
  type AuthConfigRecord,
  type AuthScheme,
  type ToolkitDefinition,
} from "../entities.ts"
import { authConfigObject } from "../formatters.ts"
import {
  api,
  badRequest,
  composioId,
  iso,
  jsonBody,
  newUuid,
  notFound,
  page,
  textOf,
  textsOf,
  toolkitKey,
} from "../helpers.ts"
import { toolkitOf } from "../lookup.ts"

/** Scopes as either a list or a comma- or space-separated string. */
function scopesOf(value: unknown): string[] {
  if (typeof value === "string") return value.split(/[\s,]+/).filter((scope) => scope !== "")

  return textsOf(value)
}

/** The credentials an auth config keeps, without its scopes, which are kept apart. */
function credentialsOf(value: unknown): Record<string, unknown> {
  const { scopes: _scopes, ...rest } = asRecord(value) ?? {}

  return rest
}

/** The toolkit an auth config is for, refused when it cannot have this kind of config. */
function toolkitFor(
  context: Pick<ComposioRouteContext, "objects">,
  slug: string,
  custom: boolean,
): ToolkitDefinition {
  const toolkit = toolkitOf(context.objects, slug)

  if (!toolkit) throw notFound("Toolkit", slug, 1201, "Toolkit_NotFound")
  if (!custom && !toolkit.managed)
    throw badRequest(`${toolkit.name} has no Composio-managed auth; create a custom auth config`)

  return toolkit
}

/** The scheme asked for, or the toolkit's first. */
function schemeFor(toolkit: ToolkitDefinition, asked: unknown): AuthScheme {
  return isOneOf(AUTH_SCHEMES, asked) ? asked : (toolkit.authSchemes[0] ?? "OAUTH2")
}

/** A new auth config for `toolkitSlug`, from the create body's `auth_config` part. */
export function newAuthConfig(
  context: Pick<ComposioRouteContext, "objects" | "clock">,
  toolkitSlug: string,
  options: Record<string, unknown>,
): AuthConfigRecord {
  const custom = options["type"] === "use_custom_auth"
  const toolkit = toolkitFor(context, toolkitSlug, custom)
  const credentials = asRecord(options["credentials"])
  const scopes = scopesOf(credentials?.["scopes"])
  const now = iso(context.clock())

  return context.objects.authConfigs.add(
    {
      id: composioId("ac"),
      uuid: newUuid(),
      name: textOf(options["name"]) ?? `${toolkit.name} Auth Config`,
      toolkit: toolkit.slug,
      type: custom ? "custom" : "default",
      authScheme: schemeFor(toolkit, options["authScheme"]),
      managed: !custom,
      credentials: custom ? credentialsOf(credentials) : {},
      scopes: scopes.length > 0 ? scopes : [...(toolkit.defaultScopes ?? [])],
      restrictToTools: textsOf(options["restrict_to_following_tools"]),
      status: "ENABLED",
      createdAt: now,
      updatedAt: now,
    },
    null,
  )
}

async function create(context: ComposioRouteContext, c: Context): Promise<Response> {
  const body = await jsonBody(c)
  const slug = textOf(asRecord(body["toolkit"])?.["slug"])

  if (slug === undefined) throw badRequest("toolkit.slug is required")

  const config = newAuthConfig(context, toolkitKey(slug), asRecord(body["auth_config"]) ?? {})

  return c.json(
    {
      toolkit: { slug: config.toolkit },
      auth_config: {
        id: config.id,
        auth_scheme: config.authScheme,
        is_composio_managed: config.managed,
        restrict_to_following_tools: [...config.restrictToTools],
      },
    } satisfies AuthConfigCreateResponse,
    201,
  )
}

async function update(context: ComposioRouteContext, c: Context): Promise<Response> {
  const config = authConfigOf(context.objects, c.req.param("id"))
  const body = await jsonBody(c)
  const credentials = asRecord(body["credentials"])
  const scopes = scopesOf(credentials?.["scopes"])
  const name = textOf(body["name"])

  context.objects.authConfigs.change(config.id, {
    ...(name !== undefined && { name }),
    ...(credentials && { credentials: { ...config.credentials, ...credentialsOf(credentials) } }),
    ...(scopes.length > 0 && { scopes }),
    ...(Array.isArray(body["restrict_to_following_tools"]) && {
      restrictToTools: textsOf(body["restrict_to_following_tools"]),
    }),
    updatedAt: iso(context.clock()),
  })

  return c.json({
    success: true,
    message: "Auth config updated",
  } satisfies AuthConfigUpdateResponse)
}

/** Auth configs: how each toolkit's accounts connect. */
export function authConfigRoutes(context: ComposioRouteContext): void {
  const { objects } = context
  const routes = api(context.app)

  routes.post("/auth_configs", (c) => create(context, c))
  routes.get("/auth_configs", (c) => {
    const toolkit = c.req.query("toolkit_slug")
    const managed = c.req.query("is_composio_managed")
    const showDisabled = c.req.query("show_disabled") === "true"
    const configs = objects.authConfigs.where(
      (config) =>
        (toolkit === undefined || config.toolkit === toolkitKey(toolkit)) &&
        (managed === undefined || String(config.managed) === managed) &&
        (showDisabled || config.status === "ENABLED"),
    )

    return c.json(
      page(
        c,
        configs.toReversed().map((config) => authConfigObject(config, objects)),
      ),
    )
  })
  routes.get("/auth_configs/:id", (c) =>
    c.json(authConfigObject(authConfigOf(objects, c.req.param("id")), objects)),
  )
  routes.patch("/auth_configs/:id", (c) => update(context, c))
  routes.patch("/auth_configs/:id/:status", (c) => {
    const config = authConfigOf(objects, c.req.param("id"))
    const status = c.req.param("status").toUpperCase()

    if (status !== "ENABLED" && status !== "DISABLED")
      throw badRequest("status must be ENABLED or DISABLED")

    objects.authConfigs.change(config.id, { status, updatedAt: iso(context.clock()) })

    return c.json({
      success: true,
      message: `Auth config ${status.toLowerCase()}`,
    } satisfies AuthConfigUpdateStatusResponse)
  })
  routes.delete("/auth_configs/:id", (c) => {
    const config = authConfigOf(objects, c.req.param("id"))

    objects.authConfigs.remove(config.id)

    return c.json({
      success: true,
      message: "Auth config deleted",
    } satisfies AuthConfigDeleteResponse)
  })
}
