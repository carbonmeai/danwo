import type { Context, Handler } from "../http.ts"
import { graphCaller } from "./auth.ts"
import type { GraphState, MicrosoftRouteContext } from "./context.ts"
import type { MicrosoftUser } from "./entities.ts"
import { graphError } from "./helpers.ts"
import type { MicrosoftStore } from "./store.ts"

/** The delegated permissions Graph's mail, calendar and files APIs ask for. */
export type GraphPermission =
  | "Mail.Read"
  | "Mail.ReadWrite"
  | "Mail.Send"
  | "Calendars.Read"
  | "Calendars.ReadWrite"
  | "Files.Read"
  | "Files.ReadWrite"

/** The granted scopes (lower case) that satisfy each permission. */
const SATISFIED_BY: Readonly<Record<GraphPermission, readonly string[]>> = {
  "Mail.Read": ["mail.read", "mail.readwrite"],
  "Mail.ReadWrite": ["mail.readwrite"],
  "Mail.Send": ["mail.send"],
  "Calendars.Read": ["calendars.read", "calendars.readwrite"],
  "Calendars.ReadWrite": ["calendars.readwrite"],
  "Files.Read": ["files.read", "files.readwrite", "files.read.all", "files.readwrite.all"],
  "Files.ReadWrite": ["files.readwrite", "files.readwrite.all"],
}

const GRAPH_RESOURCE = "https://graph.microsoft.com/"

/** A token's scopes in lower case, with Graph's resource prefix dropped. */
function grantedScopes(scope: string): Set<string> {
  return new Set(
    scope
      .split(/\s+/)
      .filter((s) => s !== "")
      .map((s) =>
        (s.startsWith(GRAPH_RESOURCE) ? s.slice(GRAPH_RESOURCE.length) : s).toLowerCase(),
      ),
  )
}

/** Whether `scope` grants `permission`; `.default` stands for every permission the app has. */
export function grants(scope: string, permission: GraphPermission): boolean {
  const granted = grantedScopes(scope)

  return granted.has(".default") || SATISFIED_BY[permission].some((s) => granted.has(s))
}

/** Which family of Graph APIs a request is for: Outlook and OneDrive word their errors differently. */
type ApiFamily = "outlook" | "drive"

const DENIED: Readonly<Record<ApiFamily, string>> = {
  outlook: "ErrorAccessDenied",
  drive: "accessDenied",
}

function denied(c: Context, state: GraphState, family: ApiFamily): Response {
  return graphError(c, state.clock, {
    status: 403,
    code: DENIED[family],
    message: "Access is denied. Check credentials and try again.",
  })
}

/** A Graph request that passed authentication and the permission check. */
export interface GraphCall {
  /** Whose mailbox, calendar or drive the request addresses. */
  readonly user: MicrosoftUser
  readonly clientId: string
  readonly microsoft: MicrosoftStore
}

/**
 * The user a `/users/{id | userPrincipalName}` path names. Delegated access reaches only the
 * signed-in user's own data, so another existing user is refused and an unknown one is not found.
 */
function addressedUser(
  c: Context,
  state: GraphState,
  caller: MicrosoftUser,
  family: ApiFamily,
  named: string,
): MicrosoftUser | Response {
  if (named === "" || named === caller.oid || named.toLowerCase() === caller.email.toLowerCase())
    return caller

  const microsoft = state.microsoft()
  const exists =
    microsoft.users.findOneBy("oid", named) ??
    microsoft.users.all().find((u) => u.email.toLowerCase() === named.toLowerCase())

  if (exists) return denied(c, state, family)

  return graphError(c, state.clock, {
    status: 404,
    code: family === "outlook" ? "ErrorInvalidUser" : "itemNotFound",
    message: `The requested user '${named}' is invalid.`,
  })
}

/**
 * Authenticates a Graph request, checks `permission`, and resolves the user it addresses: the
 * `user` path parameter, or `named` when the path was matched some other way.
 */
export function graphAccess(
  c: Context,
  state: GraphState,
  permission: GraphPermission,
  named = c.req.param("user"),
): GraphCall | Response {
  const microsoft = state.microsoft()
  const caller = graphCaller(c, microsoft, state.clock)

  if (caller instanceof Response) return caller

  const family: ApiFamily = permission.startsWith("Files") ? "drive" : "outlook"

  if (!grants(caller.scope, permission)) return denied(c, state, family)

  const user = addressedUser(c, state, caller.user, family, named)

  return user instanceof Response ? user : { user, clientId: caller.clientId, microsoft }
}

/** A Graph handler that runs once the request is authenticated and allowed. */
export type GraphHandler = (c: Context, call: GraphCall) => Response | Promise<Response>

type Method = "get" | "post" | "patch" | "delete"

/**
 * Registers a handler at `/v1.0/me{path}` and `/v1.0/users/:user{path}`, behind authentication
 * and `permission`.
 */
export function userRoute(
  context: MicrosoftRouteContext,
  method: Method,
  path: string,
  permission: GraphPermission,
  handler: GraphHandler,
): void {
  const guarded: Handler = (c) => {
    const call = graphAccess(c, context, permission)

    return call instanceof Response ? call : handler(c, call)
  }

  for (const prefix of ["/v1.0/me", "/v1.0/users/:user"]) {
    const full = `${prefix}${path}`

    if (method === "get") context.app.get(full, guarded)
    else if (method === "post") context.app.post(full, guarded)
    else if (method === "patch") context.app.patch(full, guarded)
    else context.app.delete(full, guarded)
  }
}
