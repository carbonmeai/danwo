import type { Context, ErrorHandler } from "../http.ts"
import { authenticate, requireScope, tokenOf } from "./auth.ts"
import type { Methods, SlackRouteContext } from "./context.ts"
import { type Args, asObject, SlackApiError } from "./helpers.ts"
import { releaseScheduled } from "./routes/chat.ts"

/**
 * A Web API call's arguments: the form or JSON body, plus the query string. Slack takes all three,
 * and JSON bodies only with the token in the `Authorization` header.
 */
export async function readArgs(c: Context): Promise<Args> {
  const query = Object.fromEntries(new URL(c.req.url).searchParams)
  const type = c.req.header("content-type") ?? ""

  if (/application\/json/i.test(type)) {
    const text = await c.req.text()
    const body = text === "" ? {} : asObject(JSON.parse(text))

    return { ...query, ...body }
  }

  const form = await c.req.parseBody()
  const fields = Object.entries(form).filter(([, value]) => typeof value === "string")

  return { ...query, ...Object.fromEntries(fields) }
}

/** Answers a Web API error the way Slack does: HTTP 200 and `{ ok: false, error }`. */
export function apiError(c: Context, error: SlackApiError): Response {
  return c.json({ ok: false, error: error.error, ...error.extra })
}

/**
 * `api.test`: needs no token and echoes its arguments, failing with the `error` argument when one
 * is given, so an app can check its error handling.
 */
function apiTest(c: Context, args: Args): Response {
  const { token: _token, ...echoed } = args
  const error = echoed["error"]

  return typeof error === "string" && error !== ""
    ? c.json({ ok: false, error, args: echoed })
    : c.json({ ok: true, args: echoed })
}

/** Runs one Web API method: authenticate, check scopes, then the method itself. */
async function call(c: Context, context: SlackRouteContext, methods: Methods): Promise<Response> {
  const name = c.req.param("method")
  const method = methods[name]
  const args = await readArgs(c)

  if (name === "api.test") return apiTest(c, args)
  if (!method) throw new SlackApiError("unknown_method")

  const token = authenticate(context.slack, tokenOf(c, args), context.clock)

  requireScope(token, method.scopes)
  releaseScheduled(context)

  return c.json({ ok: true, ...(await method.run({ args, token, context })) })
}

/** Serves `https://slack.com/api/{method}` for every method in `methods`, by GET or POST. */
export function apiRoutes(context: SlackRouteContext, methods: Methods): void {
  const handle = async (c: Context) => {
    try {
      return await call(c, context, methods)
    } catch (error) {
      if (error instanceof SlackApiError) return apiError(c, error)
      if (error instanceof SyntaxError) return apiError(c, new SlackApiError("invalid_json"))

      throw error
    }
  }

  context.app.post("/api/:method", handle)
  context.app.get("/api/:method", handle)
}

/** The emulator's error hook: anything unexpected is Slack's HTTP 500 `internal_error`. */
export function slackErrors(): ErrorHandler {
  return (_error, c) => c.json({ ok: false, error: "internal_error" }, 500)
}
