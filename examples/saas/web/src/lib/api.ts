/**
 * How the web app's server talks to Relay's API: with the signed-in person's Clerk session token,
 * which the API checks itself. Only server functions call this, so the token never leaves the
 * server and the API's address isn't public.
 */
import { auth } from "@clerk/tanstack-react-start/server"
import { redirect } from "@tanstack/react-router"

import type { Result } from "./types"

/** The API's answer when it isn't JSON with an `error`. */
const FALLBACK = "Something went wrong. Please try again."

async function call(path: string, method: string, body?: unknown): Promise<Response> {
  const { getToken } = await auth()
  const token = await getToken()

  return fetch(`${process.env.API_URL ?? ""}${path}`, {
    method,
    headers: {
      ...(token && { authorization: `Bearer ${token}` }),
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
}

/** The message in an API error answer. */
async function messageOf(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined)
  const error = typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined

  return typeof error === "string" ? error : FALLBACK
}

/** Reads `path` for a page; signed out, the page goes to sign-in instead. */
export async function read<T>(path: string): Promise<T> {
  const response = await call(path, "GET")

  if (response.status === 401) throw redirect({ to: "/sign-in/$", params: { _splat: "" } })
  if (!response.ok) throw new Error(await messageOf(response))

  return (await response.json()) as T
}

/**
 * Sends a change (or, with `GET`, a read whose failure the page shows inline); its answer, or the
 * message to show when it failed.
 */
export async function write<T>(path: string, body?: unknown, method = "POST"): Promise<Result<T>> {
  try {
    const response = await call(path, method, method === "GET" ? undefined : (body ?? {}))

    if (!response.ok) return { ok: false, error: await messageOf(response) }

    return { ok: true, data: (await response.json()) as T }
  } catch {
    return { ok: false, error: FALLBACK }
  }
}
