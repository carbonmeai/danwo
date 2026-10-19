import type { Context, Middleware } from "../http.ts"
import type { Store } from "../store.ts"
import { instanceOf } from "./context.ts"
import { ClerkFailure, record } from "./helpers.ts"

/** The Backend API takes the instance's secret key as a Bearer token on every call. */
export function backendAuth(store: Store): Middleware {
  return (c, next) => {
    const header = c.req.header("authorization") ?? ""
    const key = /^Bearer (.+)$/i.exec(header)?.[1]

    if (key === undefined)
      throw new ClerkFailure(
        401,
        "authorization_header_missing",
        "Authorization header missing",
        "You need to send an Authorization header with your secret key as a Bearer token.",
      )

    if (!instanceOf({ store }).secretKeys.includes(key))
      throw new ClerkFailure(
        401,
        "clerk_key_invalid",
        "Secret Key invalid",
        "The provided Secret Key is invalid. Make sure that your Secret Key is correct.",
      )

    return next()
  }
}

/** A request's JSON body (Clerk's SDKs send JSON), or its form fields, as a record. */
export async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") ?? ""

  if (type.includes("json")) {
    const text = await c.req.text()

    return text.trim() === "" ? {} : record(JSON.parse(text))
  }

  return c.req.parseBody()
}

/** Every value of a query parameter, given as `name`, `name[]` or a comma list. */
export function queryList(c: Context, name: string): string[] {
  const url = new URL(c.req.url)

  return [...url.searchParams.getAll(name), ...url.searchParams.getAll(`${name}[]`)].flatMap((v) =>
    v.split(","),
  )
}

/** `limit` and `offset` of a list call, with Clerk's default page of 10 (at most 500). */
export function pageOf(c: Context): { limit: number; offset: number } {
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? 10) || 10))
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0)

  return { limit, offset }
}
