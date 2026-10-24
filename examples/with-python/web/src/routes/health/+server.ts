import { json } from "@sveltejs/kit"

import type { RequestHandler } from "./$types"

/** Answers once the site's server is up, for a deploy's health check. */
export const GET: RequestHandler = () => json({ ok: true })
