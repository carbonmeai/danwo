/**
 * The studio's API, called from the site's server: page loads and form actions go through here.
 * `API_URL` names it, as a deployment's internal address would.
 */
import { API_URL } from "$app/env/private"
import { error } from "@sveltejs/kit"

/** An answer from the API: its status, and its JSON body. */
export interface Answer<T> {
  readonly ok: boolean
  readonly status: number
  readonly body: T
}

/**
 * Calls `path` on the API and reads its JSON answer, whatever its status. When the API can't be
 * reached at all, the page shows a 502 rather than half a page.
 */
export async function call<T>(path: string, init?: RequestInit): Promise<Answer<T>> {
  if (API_URL === undefined) throw new Error("API_URL is not set: it names the studio's API")

  let res: Response

  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { accept: "application/json", ...init?.headers },
    })
  } catch (cause) {
    console.error(`the studio's API is unreachable: ${String(cause)}`)
    error(502, "The studio is not answering just now. Please try again.")
  }

  return { ok: res.ok, status: res.status, body: (await res.json()) as T }
}

/** Reads `path`, failing the page with the API's own status and message when it says no. */
export async function read<T>(path: string): Promise<T> {
  const answer = await call<T | { readonly error: string }>(path)

  if (!answer.ok) error(answer.status, messageOf(answer.body))

  return answer.body as T
}

/** The message in an API error body, or a general one. */
export function messageOf(body: unknown): string {
  const message: unknown =
    typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined

  return typeof message === "string" ? message : "Something went wrong. Please try again."
}
