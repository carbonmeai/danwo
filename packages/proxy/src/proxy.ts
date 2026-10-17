import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  type CompletedRequest,
  generateCACertificate,
  generateSPKIFingerprint,
  getLocal,
  type Headers as MockttpHeaders,
} from "mockttp"

import { type CapturedMessage, captureMessage } from "./capture.ts"
import { forwardTo } from "./upstream.ts"

/** Answers a request the way a server would; `emulator.fetch` is one. */
export type Handler = (request: Request) => Promise<Response>

/**
 * Hosts answered by one handler. A host is an exact hostname (`api.stripe.com`) or a wildcard
 * (`*.amazonaws.com`, any subdomain at any depth, not the bare domain).
 */
export type Route =
  | { readonly hosts: readonly string[]; readonly handler: Handler }
  /** Forwarded to an outside endpoint (e.g. a MiniStack container) with the original `Host` kept. */
  | { readonly hosts: readonly string[]; readonly upstream: string }

export interface ProxyOptions {
  readonly routes: readonly Route[]
  /**
   * What happens to requests for any other host. `passthrough` (default) sends them on to the
   * real host; `block` answers 502, so a run cannot reach a real service by accident.
   */
  readonly unmatched?: "passthrough" | "block"
}

/** A request to a routed host, as a fault rule sees it. */
export interface OutboundCall {
  readonly host: string
  readonly method: string
  readonly path: string
  /** Position among routed calls since the proxy started or was last cleared, from 0. */
  readonly index: number
}

/**
 * What to do to one routed call instead of answering it normally:
 * - `status`: answer with this status (and body/headers) without reaching the handler;
 * - `reset`: drop the connection before the handler sees the request;
 * - `reset-after`: let the handler process it, then drop the connection, so the side effect
 *   happens but the client never sees the response;
 * - `delay`: wait, then answer normally.
 */
export type OutboundFault =
  | {
      readonly kind: "status"
      readonly status: number
      readonly body?: string
      readonly headers?: Record<string, string>
    }
  | { readonly kind: "reset" }
  | { readonly kind: "reset-after" }
  | { readonly kind: "delay"; readonly ms: number }

export type OutboundFaultRule = (call: OutboundCall) => OutboundFault | undefined

/** A short label for a fault, for logs and reports. */
export function describeOutboundFault(fault: OutboundFault): string {
  switch (fault.kind) {
    case "status":
      return `status ${fault.status}`
    case "delay":
      return `delay ${fault.ms}ms`
    default:
      return fault.kind
  }
}

/** One request through the proxy, for the flight recorder. */
export interface Exchange {
  /** What happened to it: answered by a route, passed to the real host, or refused. */
  readonly disposition: "routed" | "passthrough" | "blocked"
  readonly method: string
  readonly host: string
  /** Path and query, as the client asked for them. */
  readonly path: string
  readonly startedAt: string
  /** Unique within the proxy's run. */
  readonly id: string
  /** The fault injected into this exchange, if any. */
  fault: string | null
  /** Null until the response is sent, and for aborted requests. */
  status: number | null
  durationMs: number | null
  aborted: boolean
  /** The request as the client sent it; absent until its body has arrived. Unredacted. */
  request?: CapturedMessage
  /** The response the client got; absent until it was sent, and for aborted requests. Unredacted. */
  response?: CapturedMessage
}

export interface Proxy {
  /** `http://127.0.0.1:<port>`: the proxy for HTTP and HTTPS (CONNECT). */
  readonly url: string
  /** PEM of the certificate authority this proxy signs intercepted connections with. */
  readonly caCert: string
  readonly caCertPath: string
  /**
   * Base64 SHA-256 of the CA's public key. Chromium trusts certificates chained to it with
   * `--ignore-certificate-errors-spki-list=<this>`, without touching the system trust store.
   */
  readonly caSpki: string
  /**
   * Environment for a Node app to route through the proxy with no code changes: proxy variables,
   * `NODE_USE_ENV_PROXY=1`, the CA in `NODE_EXTRA_CA_CERTS`, and the agent preload appended to
   * `NODE_OPTIONS`. Merged over `base` (default `process.env`).
   */
  env(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  exchanges(): readonly Exchange[]
  /** Sets the rule that picks a fault for each routed call; `undefined` removes it. */
  setFault(rule: OutboundFaultRule | undefined): void
  /** Forgets recorded exchanges and restarts call numbering, for reuse across runs. */
  clear(): void
  /**
   * Resolves once every exchange seen so far has finished (responded or aborted). The proxy
   * reports a response slightly after the client receives it, so read `exchanges()` after this.
   */
  settled(timeoutMs?: number): Promise<void>
  stop(): Promise<void>
}

/** True when `host` matches an exact hostname or a `*.domain` wildcard. */
export function hostMatches(pattern: string, host: string): boolean {
  return pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern
}

function routeHandler(route: Route): Handler {
  return "handler" in route ? route.handler : forwardTo(route.upstream)
}

const PRELOAD = fileURLToPath(new URL("../preload.mjs", import.meta.url))

function toFetchHeaders(headers: MockttpHeaders): Headers {
  const out = new Headers()

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name.startsWith(":")) continue
    for (const v of Array.isArray(value) ? value : [value]) out.append(name, v)
  }

  return out
}

function fromFetchHeaders(headers: Headers): MockttpHeaders {
  const out: MockttpHeaders = {}

  headers.forEach((value, name) => {
    if (name === "set-cookie") return
    out[name] = value
  })
  const cookies = headers.getSetCookie()

  if (cookies.length > 0) out["set-cookie"] = cookies

  return out
}

async function callHandler(handler: Handler, req: CompletedRequest) {
  const hasBody = req.method !== "GET" && req.method !== "HEAD"
  /*
   * mockttp decodes gzip, deflate, br and zstd; for an encoding it does not know (S3's
   * aws-chunked) it gives nothing, so the handler gets the raw bytes and the encoding header.
   */
  const decoded = hasBody ? await req.body.getDecodedBuffer() : undefined
  const body = hasBody ? (decoded ?? req.body.buffer) : undefined
  const headers = toFetchHeaders(req.headers)

  if (decoded) headers.delete("content-encoding")
  headers.delete("content-length")
  const response = await handler(
    new Request(req.url, {
      method: req.method,
      headers,
      ...(body && body.length > 0 && { body: new Uint8Array(body) }),
    }),
  )

  return {
    statusCode: response.status,
    headers: fromFetchHeaders(response.headers),
    rawBody: Buffer.from(await response.arrayBuffer()),
  }
}

/** Answers a request the way `fault` says, or through its handler when there is no fault. */
async function answerUnder(
  fault: OutboundFault | undefined,
  handler: Handler,
  req: CompletedRequest,
) {
  switch (fault?.kind) {
    case "status":
      return {
        statusCode: fault.status,
        headers: { "content-type": "application/json", ...fault.headers },
        body: fault.body ?? "",
      }
    case "reset":
      return "reset" as const
    case "reset-after":
      await callHandler(handler, req)

      return "reset" as const
    case "delay":
      await new Promise((resolve) => setTimeout(resolve, fault.ms))

      return callHandler(handler, req)
    default:
      return callHandler(handler, req)
  }
}

/**
 * Starts an HTTPS-intercepting proxy. Requests for a routed host are answered in-process by its
 * handler or forwarded to its upstream; others pass through or are blocked. Faults apply to both
 * kinds of route. Every exchange is recorded.
 */
export async function startProxy(options: ProxyOptions): Promise<Proxy> {
  const dir = await mkdtemp(join(tmpdir(), "danwo-proxy-"))
  const ca = await generateCACertificate({ subject: { commonName: "danwo proxy CA" } })
  const caCertPath = join(dir, "ca.pem")

  await writeFile(caCertPath, ca.cert)

  const server = getLocal({ https: ca })

  await server.start()

  const patterns = options.routes.flatMap((r) => r.hosts)
  const isRouted = (host: string) => patterns.some((pattern) => hostMatches(pattern, host))
  let faultRule: OutboundFaultRule | undefined
  let callIndex = 0
  const log = new Map<string, Exchange>()
  // The route handler can run before the exchange is logged; hold its fault label until then.
  const faultLabels = new Map<string, string>()

  function labelFault(id: string, label: string): void {
    const exchange = log.get(id)

    if (exchange) exchange.fault = label
    else faultLabels.set(id, label)
  }

  async function handle(handler: Handler, req: CompletedRequest) {
    const call = {
      host: req.destination.hostname,
      method: req.method,
      path: req.path,
      index: callIndex++,
    }
    const fault = faultRule?.(call)

    if (fault) labelFault(req.id, describeOutboundFault(fault))

    return answerUnder(fault, handler, req)
  }

  /*
   * Exact hosts first, then wildcards from the most specific, so `*.s3.amazonaws.com` wins over
   * `*.amazonaws.com` whatever order the routes come in. `always()`: without it mockttp hands a
   * request to a later matching rule once an earlier one has matched.
   */
  const bound = options.routes.flatMap((route) => {
    const handler = routeHandler(route)

    return route.hosts.map((host) => ({ host, handler }))
  })
  const exact = bound.filter((b) => !b.host.startsWith("*."))
  const wildcards = bound
    .filter((b) => b.host.startsWith("*."))
    .toSorted((a, b) => b.host.length - a.host.length)

  for (const { host, handler } of exact) {
    await server
      .forAnyRequest()
      .forHostname(host)
      .always()
      .thenCallback((req) => handle(handler, req))
  }

  for (const { host, handler } of wildcards) {
    await server
      .forAnyRequest()
      .matching((req) => hostMatches(host, req.destination.hostname))
      .always()
      .thenCallback((req) => handle(handler, req))
  }

  if (options.unmatched === "block") {
    await server
      .forUnmatchedRequest()
      .thenReply(502, "danwo proxy: host is not routed and passthrough is blocked")
  } else {
    await server.forUnmatchedRequest().thenPassThrough()
  }

  const waiters = new Set<() => void>()
  // Bodies are read off the event loop; an exchange counts as finished once its captures land.
  const capturing = new Set<Promise<void>>()
  const finished = () =>
    capturing.size === 0 && [...log.values()].every((e) => e.status !== null || e.aborted)

  const capture = (work: Promise<void>) => {
    const tracked = work.finally(() => {
      capturing.delete(tracked)
      notify()
    })

    capturing.add(tracked)
  }

  const notify = () => {
    if (finished()) for (const resolve of waiters) resolve()
  }

  // `request-initiated` always comes first; `request` can arrive after a fast `response`.
  await server.on("request-initiated", (req) => {
    const host = req.destination.hostname

    log.set(req.id, {
      id: req.id,
      host,
      method: req.method,
      path: req.path,
      disposition: isRouted(host)
        ? "routed"
        : options.unmatched === "block"
          ? "blocked"
          : "passthrough",
      startedAt: new Date(req.timingEvents.startTime).toISOString(),
      status: null,
      durationMs: null,
      aborted: false,
      fault: faultLabels.get(req.id) ?? null,
    })
    faultLabels.delete(req.id)
  })
  await server.on("request", (req) => {
    capture(
      captureMessage(req.headers, req.body).then((message) => {
        const exchange = log.get(req.id)

        if (exchange) exchange.request = message
      }),
    )
  })
  await server.on("response", (res) => {
    const exchange = log.get(res.id)

    if (!exchange) return
    capture(
      captureMessage(res.headers, res.body).then((message) => {
        exchange.response = message
      }),
    )
    exchange.status = res.statusCode
    const { startTimestamp, responseSentTimestamp } = res.timingEvents

    exchange.durationMs =
      responseSentTimestamp === undefined
        ? null
        : Math.round(responseSentTimestamp - startTimestamp)
    notify()
  })
  await server.on("abort", (req) => {
    const exchange = log.get(req.id)

    if (exchange) exchange.aborted = true
    notify()
  })

  const url = `http://127.0.0.1:${server.port}`

  return {
    url,
    caCert: ca.cert,
    caCertPath,
    caSpki: await generateSPKIFingerprint(ca.cert),
    env(base = process.env) {
      const preload = `--import=${pathToFileURL(PRELOAD).href}`

      return {
        ...base,
        HTTPS_PROXY: url,
        HTTP_PROXY: url,
        https_proxy: url,
        http_proxy: url,
        NODE_USE_ENV_PROXY: "1",
        NODE_EXTRA_CA_CERTS: caCertPath,
        NODE_OPTIONS: [base.NODE_OPTIONS, preload].filter(Boolean).join(" "),
      }
    },
    exchanges: () => [...log.values()],
    setFault(rule) {
      faultRule = rule
    },
    clear() {
      log.clear()
      faultLabels.clear()
      callIndex = 0
    },
    settled(timeoutMs = 5_000) {
      if (finished()) return Promise.resolve()

      return new Promise<void>((resolve, reject) => {
        const done = () => {
          clearTimeout(timer)
          waiters.delete(done)
          resolve()
        }

        const timer = setTimeout(() => {
          waiters.delete(done)
          reject(new Error(`proxy exchanges still open after ${timeoutMs}ms`))
        }, timeoutMs)

        waiters.add(done)
      })
    },
    async stop() {
      await server.stop()
      await rm(dir, { recursive: true, force: true })
    },
  }
}
