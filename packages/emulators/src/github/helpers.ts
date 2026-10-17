import { HttpError } from "../errors.ts"
import type { App, Context, ErrorHandler } from "../http.ts"
import type { Collection, DataKey, Entity, Store } from "../store.ts"

/** The REST API's origin. */
export const API = "https://api.github.com"

/** github.com, where people browse and where OAuth sign-in happens. */
export const WEB = "https://github.com"

/** The hosts GitHub's API and sign-in use; route them to the emulator. */
export const GITHUB_HOSTS = ["github.com", "api.github.com"] as const

const DOCS = "https://docs.github.com/rest"

/** One entry of a 422's `errors` list. */
export interface FieldError {
  readonly resource: string
  readonly field: string
  readonly code:
    | "missing"
    | "missing_field"
    | "invalid"
    | "already_exists"
    | "unprocessable"
    | "custom"
  readonly message?: string
}

/** A failure a GitHub handler throws; the error hook answers it in GitHub's error format. */
export class GithubApiError extends HttpError {
  readonly errors: readonly FieldError[] | undefined
  readonly headers: Readonly<Record<string, string>>

  constructor(
    status: number,
    message: string,
    options: { errors?: readonly FieldError[]; headers?: Record<string, string> } = {},
  ) {
    super(status, message)
    this.errors = options.errors
    this.headers = options.headers ?? {}
  }
}

/** GitHub's error body: `{ message, documentation_url, status }`, plus `errors` for a 422. */
export function githubErrorBody(status: number, message: string, errors?: readonly FieldError[]) {
  return {
    message,
    ...(errors && { errors }),
    documentation_url: DOCS,
    status: String(status),
  }
}

/** Answers every error in GitHub's format; anything unexpected is a 500. */
export function githubErrors(): ErrorHandler {
  return (error, c) => {
    if (error instanceof GithubApiError)
      return c.json(
        githubErrorBody(error.status, error.message, error.errors),
        error.status,
        error.headers,
      )

    return c.json(githubErrorBody(500, "Server Error"), 500)
  }
}

/** GitHub hides what a caller may not see behind a plain 404. */
export const notFound = (): GithubApiError => new GithubApiError(404, "Not Found")

/** A 422 for a request GitHub would refuse as invalid. */
export function invalid(errors: readonly FieldError[], message = "Validation Failed") {
  return new GithubApiError(422, message, { errors })
}

/** A 422 for a required field that was not sent. */
export function missingField(resource: string, field: string): GithubApiError {
  return invalid([{ resource, field, code: "missing_field" }])
}

/** The last id handed out by the sequence every GitHub object shares. */
const NEXT_ID: DataKey<number> = { name: "github.nextId" }

/** The next id from the sequence every GitHub object shares. */
export function nextGhId(store: Store): number {
  const next = (store.getData(NEXT_ID) ?? 10_000_000) + 1

  store.setData(NEXT_ID, next)

  return next
}

/** A GraphQL node id: the object's kind and its numeric id, opaque to clients. */
export function nodeId(kind: string, id: number | string): string {
  return `${kind}_${Buffer.from(`0:${id}`).toString("base64url")}`
}

/** GitHub writes timestamps to the second: `2011-01-26T19:01:12Z`. */
export function ghTime(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z")
}

/** The request's JSON body as an object; anything else is a 400, as GitHub answers. */
export async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const text = await c.req.text()

  if (text.trim() === "") return {}

  try {
    const value: unknown = JSON.parse(text)

    if (typeof value === "object" && value !== null && !Array.isArray(value))
      return Object.fromEntries(Object.entries(value))
  } catch {
    /* falls through to the 400 below */
  }

  throw new GithubApiError(400, "Problems parsing JSON")
}

/** A JSON object as a plain record; anything else is an empty one. */
export function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

/** A string field of a JSON body, if it is one. */
export function stringField(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name]

  return typeof value === "string" ? value : undefined
}

/** `{ [key]: value }` when the value was given, else nothing: for spreading optional changes. */
export function given<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  const out: Partial<Record<K, V>> = {}

  if (value !== undefined) out[key] = value

  return out
}

/** A list-of-strings field of a JSON body; non-strings are dropped. */
export function stringsField(body: Record<string, unknown>, name: string): string[] | undefined {
  const value = body[name]

  return Array.isArray(value)
    ? value.filter((item: unknown): item is string => typeof item === "string")
    : undefined
}

/** A route whose last part may contain slashes: a file path or a ref name. */
type TailHandler = (
  c: Context,
  match: { readonly owner: string; readonly repo: string; readonly tail: string },
) => Response | Promise<Response>

/**
 * Registers `method /repos/{owner}/{repo}/<prefix>/<tail…>`, where the tail may span several
 * segments or arrive with its slashes encoded (`heads%2Fmain`).
 */
export function tailRoute(app: App, method: string, prefix: string, handler: TailHandler): void {
  const pattern = new RegExp(`^/repos/([^/]+)/([^/]+)/${prefix}(?:/(.*))?$`)

  app.use((c, next) => {
    const found = c.req.method === method ? pattern.exec(c.req.path) : null

    if (!found) return next()

    const [, owner = "", repo = "", tail = ""] = found.map((part) => decodeURIComponent(part ?? ""))

    return handler(c, { owner, repo, tail: tail.replace(/\/+$/, "") })
  })
}

/** `?per_page` (1 to 100, default 30) and `?page` (from 1). */
function pageWindow(c: Context): { readonly perPage: number; readonly page: number } {
  const perPage = Math.trunc(Number(c.req.query("per_page") ?? 30))
  const page = Math.trunc(Number(c.req.query("page") ?? 1))

  return {
    perPage: perPage >= 1 ? Math.min(perPage, 100) : 30,
    page: page >= 1 ? page : 1,
  }
}

/** `url` with its `page` parameter set to `page`. */
function pageUrl(url: string, page: number): string {
  const target = new URL(url)

  target.searchParams.set("page", String(page))

  return target.toString()
}

/** The `Link` header GitHub sends with a paged list. */
function linkHeader(url: string, page: number, last: number): string | undefined {
  const at = (n: number) => pageUrl(url, n)
  const links = [
    page < last && `<${at(page + 1)}>; rel="next"`,
    page < last && `<${at(last)}>; rel="last"`,
    page > 1 && `<${at(1)}>; rel="first"`,
    page > 1 && `<${at(page - 1)}>; rel="prev"`,
  ].filter((link) => typeof link === "string")

  return links.length > 0 ? links.join(", ") : undefined
}

/** One page of `items`, with the `Link` header for the others set on the response. */
export function paged<T>(c: Context, items: readonly T[]): T[] {
  const { perPage, page } = pageWindow(c)
  const last = Math.max(1, Math.ceil(items.length / perPage))
  const link = linkHeader(c.req.url, page, last)

  if (link) c.header("link", link)

  return items.slice((page - 1) * perPage, page * perPage)
}

/** The first row of one repository that passes `test`; rows are matched by their `repoId`. */
export function inRepo<T extends Entity & { repoId: number }>(
  rows: Collection<T>,
  repoId: number,
  test: (row: T) => boolean,
): T | undefined {
  return rows.all().find((row) => row.repoId === repoId && test(row))
}
