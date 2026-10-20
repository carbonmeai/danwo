import type { Middleware } from "./http.ts"

/**
 * Answers a browser that calls a provider's API from the app's own page, as the provider does:
 * every answer names the calling origin and allows credentials, and preflights (`OPTIONS`) are
 * answered here with the headers the browser asked to send. Requests without an `Origin` (a
 * server's calls) pass untouched. `applies` limits it to the paths the browser calls.
 */
export function browserCors(applies: (path: string) => boolean = () => true): Middleware {
  return async (c, next) => {
    const origin = c.req.header("origin")

    if (origin === undefined || !applies(c.req.path)) return next()

    const headers = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers":
        c.req.header("access-control-request-headers") ?? "content-type, authorization",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      vary: "Origin",
    }

    if (c.req.method === "OPTIONS") return new Response(null, { status: 204, headers })

    for (const [name, value] of Object.entries(headers)) c.header(name, value)

    return next()
  }
}
