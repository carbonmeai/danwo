import { type IncomingMessage, request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { buffer } from "node:stream/consumers"

import type { Handler } from "./proxy.ts"

/** Hop-by-hop or recomputed headers that must not be carried from one connection to the other. */
const SKIP_HEADERS = new Set(["connection", "keep-alive", "transfer-encoding", "content-length"])

function responseHeaders(res: IncomingMessage): Headers {
  const headers = new Headers()

  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined || SKIP_HEADERS.has(name)) continue
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v)
  }

  return headers
}

function hasNullBody(status: number): boolean {
  return status === 101 || status === 204 || status === 205 || status === 304
}

async function toResponse(res: IncomingMessage): Promise<Response> {
  const received = await buffer(res)
  const status = res.statusCode ?? 502
  const body = hasNullBody(status) ? null : new Uint8Array(received)

  return new Response(body, { status, headers: responseHeaders(res) })
}

function requestHeaders(request: Request, url: URL, body: Buffer): Record<string, string> {
  const headers: Record<string, string> = {}

  request.headers.forEach((value, name) => {
    if (!SKIP_HEADERS.has(name)) headers[name] = value
  })
  /*
   * Keep the host the app addressed: SigV4 signs it, and services like MiniStack read the
   * bucket of a virtual-hosted S3 request from it.
   */
  headers.host = url.host
  if (body.length > 0) headers["content-length"] = String(body.length)

  return headers
}

/**
 * A handler that forwards each request to `upstream` (e.g. `http://127.0.0.1:4566`), keeping the
 * method, path, query, headers (including the original `Host`) and body.
 */
export function forwardTo(upstream: string): Handler {
  const target = new URL(upstream)
  const send = target.protocol === "https:" ? httpsRequest : httpRequest

  return async (request) => {
    const url = new URL(request.url)
    const body = Buffer.from(await request.arrayBuffer())

    return new Promise<Response>((resolve, reject) => {
      const req = send(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port,
          method: request.method,
          path: `${url.pathname}${url.search}`,
          headers: requestHeaders(request, url, body),
        },
        (res) => {
          void toResponse(res).then(resolve, reject)
        },
      )

      req.on("error", reject)
      req.end(body.length > 0 ? body : undefined)
    })
  }
}
