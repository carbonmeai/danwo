/**
 * The studio's API, called from the browser: a page that refreshes itself asks the API directly
 * at `PUBLIC_API_URL`, which lets the site's origin read its answers.
 */
import { PUBLIC_API_URL } from "$app/env/public"

/** Reads `path` from the API in the browser; throws on a failed answer. */
export async function fetchFromApi<T>(path: string): Promise<T> {
  if (PUBLIC_API_URL === undefined) throw new Error("PUBLIC_API_URL is not set")

  const res = await fetch(`${PUBLIC_API_URL}${path}`, { headers: { accept: "application/json" } })

  if (!res.ok) throw new Error(`the studio's API answered ${res.status}`)

  return (await res.json()) as T
}
