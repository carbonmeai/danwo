import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  type CompletedRequest,
  generateCACertificate,
  generateSPKIFingerprint,
  getLocal,
  type Headers as MockttpHeaders,
  type Mockttp,
} from "mockttp"

import { type AppClock, createAppClock } from "./app-clock.ts"
import { isAssetKind, type LoadKind, loadKind } from "./assets.ts"
import { type CapturedMessage, captureMessage } from "./capture.ts"
import { clientOf, userField } from "./clients.ts"
import {
  hostMatches,
  isLoopback,
  isPageAsset,
  isScriptHost,
  isStreaming,
  TELEMETRY_HOSTS,
} from "./hosts.ts"
import { isListening, nothingListening } from "./listening.ts"
import {
  caBundle,
  type EnvOptions,
  PROBE_HEADER,
  PROBE_HOST,
  preloadedPids,
  proxyEnvironment,
  type UnroutedProcess,
  unroutedProcesses,
  writeNodeShim,
} from "./node-env.ts"
import { quietDroppedClients } from "./quiet.ts"
import { replaceSocketHelpers } from "./socket-helpers.ts"
import { acceptSocketUrls } from "./socket-urls.ts"
import { forwardTo } from "./upstream.ts"
import {
  handleSockets,
  type SocketExchange,
  type SocketFaultRule,
  type SocketUpstream,
} from "./websocket.ts"

export { hostMatches } from "./hosts.ts"

/** Answers a request the way a server would; `emulator.fetch` is one. */
export type Handler = (request: Request) => Promise<Response>

/**
 * Hosts answered by one handler. A host is an exact hostname (`api.stripe.com`) or a wildcard
 * (`*.amazonaws.com`, any subdomain at any depth, not the bare domain).
 */
export type Route =
  | {
      readonly hosts: readonly string[]
      readonly handler: Handler
      /** Where this route's WebSockets go (`ws://…`); without one, upgrades are refused with 501. */
      readonly webSocket?: string
    }
  /** Forwarded to an outside endpoint (e.g. a MiniStack container) with the original `Host` kept. */
  | { readonly hosts: readonly string[]; readonly upstream: string }

export interface ProxyOptions {
  readonly routes: readonly Route[]
  /**
   * What happens to requests for any other host. `passthrough` (default) sends them on to the
   * real host; `block` answers 502, so a run cannot reach a real service by accident.
   */
  readonly unmatched?: "passthrough" | "block"
  /**
   * Hosts (exact, or `*.domain`) answered 502 and logged as `blocked` even when other hosts pass
   * through: background traffic of no interest to a run, such as a device browser's own sync.
   */
  readonly blocked?: readonly string[]
  /**
   * Hosts that always pass through, even when `unmatched` is `block` or a `blocked` pattern
   * covers them. This machine (`localhost`, `127.0.0.1`, `::1`) always does: it is where the
   * apps a run starts, and services such as Inngest dev, answer.
   */
  readonly allow?: readonly string[]
  /**
   * Analytics, error reporting and telemetry hosts (`TELEMETRY_HOSTS`): blocked by default, so
   * a run neither sends real data out nor fills its record with noise; `passthrough` lets them go.
   */
  readonly telemetry?: "block" | "passthrough"
  /**
   * What happens, while `unmatched` is `block`, to a page's images, fonts, stylesheets and media
   * from a host no route answers (told by `Sec-Fetch-Dest`, or by the file's extension and
   * `Accept`): `passthrough` (default) lets them load, so a page looks as it should; `block`
   * refuses them with the rest. Scripts, documents, frames, workers and `fetch()` calls never pass
   * this way, and telemetry and `blocked` hosts stay blocked.
   */
  readonly assets?: "passthrough" | "block"
}

/**
 * A request to a routed host, or a page's `fetch()` to an app on this machine (see
 * {@link isPageCallToApp}), as a fault rule sees it.
 */
export interface OutboundCall {
  readonly host: string
  readonly method: string
  readonly path: string
  /** Position among the calls fault rules saw since the proxy started or was last cleared, from 0. */
  readonly index: number
}

/**
 * What to do to one routed call instead of answering it normally:
 * - `status`: answer with this status (and body/headers) without reaching the handler;
 * - `reset`: drop the connection before the handler sees the request;
 * - `reset-after`: let the handler process it, then drop the connection, so the side effect
 *   happens but the client never sees the response;
 * - `delay`: wait, then answer normally;
 * - `slow-then-retry`: hold the request back for up to `ms`, or until the client gives up on it,
 *   then let the handler process it anyway, so a client that timed out and retried races its own
 *   first request: both reach the provider;
 * - `emulate`: let the route's handler answer, told through `EMULATE_HEADER` to misbehave in a way
 *   only it can shape, such as a model refusing or a stream cut short.
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
  | { readonly kind: "slow-then-retry"; readonly ms: number }
  | { readonly kind: "emulate"; readonly behaviour: string }

/**
 * Not a fault a plan names but one a run arms in-process: let the handler answer, then keep the
 * answer back until `until` resolves, so something else lands first (a provider's webhook before
 * the redirect that follows a payment). `until` sees the answer, so it can let one through at once.
 */
export interface AnswerHold {
  readonly kind: "hold"
  readonly until: (answer: HeldAnswer) => Promise<void>
}

/** What a held call answered: its status and where it sends the client, if anywhere. */
export interface HeldAnswer {
  readonly status: number
  readonly location: string | undefined
}

/** The request header that carries an `emulate` fault's behaviour to the route's handler. */
export const EMULATE_HEADER = "x-danwo-emulate"

export type OutboundFaultRule = (call: OutboundCall) => OutboundFault | AnswerHold | undefined

/** A short label for a fault, for logs and reports. */
export function describeOutboundFault(fault: OutboundFault | AnswerHold): string {
  switch (fault.kind) {
    case "status":
      return `status ${fault.status}`
    case "delay":
      return `delay ${fault.ms}ms`
    case "slow-then-retry":
      return `slow-then-retry ${fault.ms}ms`
    case "emulate":
      return fault.behaviour
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
  /**
   * Who sent it: `browser` when its user agent is a browser's, otherwise `server` (the app's own
   * backend, or another program the run started). Always set by the proxy.
   */
  readonly client?: "browser" | "server"
  /** The person whose browser sent it, in a test that opened more than one person's browser. */
  readonly user?: string
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
  /**
   * True for a response that streams for as long as the client listens (server-sent events,
   * NDJSON feeds): readiness does not wait for it to finish.
   */
  stream?: boolean
  /**
   * True for the page loading itself (a static file, a dev server's module or hot reload), not a
   * call the app makes: readiness, effects and the matrix leave these out.
   */
  asset?: boolean
  /**
   * What the request loads, from the headers a browser sends with it (`Sec-Fetch-Dest`): an image,
   * a font, a script, the page, a `fetch()` call (`request`). Absent for a server's own calls.
   */
  readonly load?: LoadKind
}

export interface Proxy {
  /** `http://127.0.0.1:<port>`: the proxy for HTTP and HTTPS (CONNECT). */
  readonly url: string
  /** PEM of the certificate authority this proxy signs intercepted connections with. */
  readonly caCert: string
  readonly caCertPath: string
  /**
   * The CA with the public roots after it, one PEM file: what `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`
   * and `CURL_CA_BUNDLE` name in `env()`, for apps outside Node, whose variables replace their
   * default trust rather than add to it.
   */
  readonly caBundlePath: string
  /**
   * Base64 SHA-256 of the CA's public key. Chromium trusts certificates chained to it with
   * `--ignore-certificate-errors-spki-list=<this>`, without touching the system trust store.
   */
  readonly caSpki: string
  /**
   * Environment for an app to route through the proxy with no code changes: the proxy variables
   * (`HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`, upper and lower case), the CA bundle in
   * `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE` and `CURL_CA_BUNDLE` for apps in any language, and for
   * Node `NODE_USE_ENV_PROXY=1`, the CA in `NODE_EXTRA_CA_CERTS` and the preload appended to
   * `NODE_OPTIONS` (and to `BUN_OPTIONS` for Bun apps). The preload also runs the app's `Date` on
   * `clock`. Merged over `base` (default `process.env`). A `node` shim goes first on PATH, so a
   * start script that replaces NODE_OPTIONS still loads the preload (`nodeShim: false` leaves it
   * out).
   */
  env(base?: NodeJS.ProcessEnv, options?: EnvOptions): NodeJS.ProcessEnv
  /**
   * The pids of the processes started with `env()` that loaded the preload, reached the proxy
   * through it, and still run: a Node process of the app's that is missing from here calls
   * providers without the proxy.
   */
  preloaded(): Promise<readonly number[]>
  /**
   * The processes started with `env()` that loaded the preload but whose calls missed the proxy
   * (a Node the preload cannot route), running or not.
   */
  unrouted(): Promise<readonly UnroutedProcess[]>
  /** The clock of every app started with `env()`: an offset ahead of real time the runner moves. */
  readonly clock: AppClock
  exchanges(): readonly Exchange[]
  /** Every WebSocket connection through the proxy, with its frame counts and sizes. */
  sockets(): readonly SocketExchange[]
  /**
   * Sets the rule that picks a fault for each routed call, and for each page's `fetch()` to an app
   * on this machine; `undefined` removes it.
   */
  setFault(rule: OutboundFaultRule | undefined): void
  /**
   * Makes the next `times` (default 1) routed calls that `match` meet `fault`, ahead of the rule
   * `setFault` set, which still faults every other call: how a test fails one step once, e.g.
   * `proxy.failNext((call) => call.path === "/emails", { kind: "reset-after" })`. `clear()`
   * disarms what is left.
   */
  failNext(match: (call: OutboundCall) => boolean, fault: OutboundFault, times?: number): void
  /** Sets the rule that refuses or drops WebSockets; `undefined` removes it. */
  setSocketFault(rule: SocketFaultRule | undefined): void
  /**
   * Forgets recorded exchanges and sockets, disarms `failNext` faults and restarts call numbering,
   * for reuse across runs.
   */
  clear(): void
  /**
   * Resolves once every exchange seen so far has finished (responded or aborted). The proxy
   * reports a response slightly after the client receives it, so read `exchanges()` after this.
   */
  settled(timeoutMs?: number): Promise<void>
  stop(): Promise<void>
}

function routeHandler(route: Route): Handler {
  return "handler" in route ? route.handler : forwardTo(route.upstream)
}

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

async function callHandler(handler: Handler, req: CompletedRequest, behaviour?: string) {
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
  if (behaviour !== undefined) headers.set(EMULATE_HEADER, behaviour)

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

/** The handler's answer, kept back until `until` resolves. */
async function answerAfter(handler: Handler, req: CompletedRequest, until: AnswerHold["until"]) {
  const answer = await callHandler(handler, req)
  const location = answer.headers.location

  await until({
    status: answer.statusCode,
    location: Array.isArray(location) ? location[0] : location,
  })

  return answer
}

/** Resolves after `ms`, or as soon as `gaveUp` does: the client stopped waiting. */
function holdBack(ms: number, gaveUp: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms)
    }),
    gaveUp,
  ]).finally(() => clearTimeout(timer))
}

/**
 * Answers a request the way `fault` says, or through its handler when there is no fault. `gaveUp`
 * resolves when the client aborts the request; `ended` says whether the run it belongs to is over
 * (`clear()` was called since it arrived).
 */
async function answerUnder(
  fault: OutboundFault | AnswerHold | undefined,
  handler: Handler,
  req: CompletedRequest,
  gaveUp: Promise<void>,
  ended: () => boolean,
) {
  if (fault === undefined) return callHandler(handler, req)
  if (fault.kind === "status")
    return {
      statusCode: fault.status,
      headers: { "content-type": "application/json", ...fault.headers },
      body: fault.body ?? "",
    }
  if (fault.kind === "reset" || fault.kind === "reset-after")
    return answerReset(fault, handler, req)
  if (fault.kind === "emulate") return callHandler(handler, req, fault.behaviour)

  return answerLate(fault, handler, req, gaveUp, ended)
}

/** Drops the connection; `reset-after` lets the handler process the request first. */
async function answerReset(
  fault: Extract<OutboundFault, { kind: "reset" | "reset-after" }>,
  handler: Handler,
  req: CompletedRequest,
) {
  if (fault.kind === "reset-after") await callHandler(handler, req)

  return "reset" as const
}

/**
 * The faults that answer normally, only later: after a wait, a hold-up, or something else lands. A
 * delayed call still reaches its handler once the client has given up, as a slow server still
 * acts on a request; but not once its run is over, or a delay longer than the trial (and the
 * client's own timeout) would land its write in the next trial's freshly restored emulator.
 */
async function answerLate(
  fault: Extract<OutboundFault, { kind: "delay" | "slow-then-retry" }> | AnswerHold,
  handler: Handler,
  req: CompletedRequest,
  gaveUp: Promise<void>,
  ended: () => boolean,
) {
  if (fault.kind === "hold") return answerAfter(handler, req, fault.until)

  await (fault.kind === "delay"
    ? new Promise((resolve) => setTimeout(resolve, fault.ms))
    : holdBack(fault.ms, gaveUp))

  if (ended()) return "reset" as const

  return callHandler(handler, req)
}

/**
 * Whether an exchange is a page's `fetch()` or XHR to an app on this machine, passed through to
 * it: a call a single-page app makes to its own API. Fault rules see these as they see routed
 * calls, so the fault matrix can fail them; a stream the page reads for as long as it is open
 * (server-sent events) is left alone.
 */
export function isPageCallToApp(exchange: {
  readonly disposition: Exchange["disposition"]
  readonly client?: Exchange["client"] | undefined
  readonly load?: LoadKind | undefined
  readonly host: string
  readonly stream?: boolean | undefined
}): boolean {
  return (
    exchange.disposition === "passthrough" &&
    exchange.client === "browser" &&
    exchange.load === "request" &&
    exchange.stream !== true &&
    isLoopback(exchange.host)
  )
}

/** How the proxy treats a host no route answers: let it through, or refuse it. */
interface HostPolicy {
  readonly isRouted: (host: string) => boolean
  readonly isBlocked: (host: string) => boolean
  readonly isAllowed: (host: string) => boolean
  /** A page asset from an unrouted, unblocked host, which passes even while `unmatched` is `block`. */
  readonly passesAsAsset: (host: string, kind: LoadKind | undefined, method: string) => boolean
  readonly unmatched: "passthrough" | "block"
  readonly upstreamOf: (host: string) => string | undefined
  dispositionOf(host: string, kind?: LoadKind, method?: string): Exchange["disposition"]
}

function matchesAny(patterns: readonly string[], host: string): boolean {
  return patterns.some((pattern) => hostMatches(pattern, host))
}

function hostPolicy(options: ProxyOptions, isRouted: (host: string) => boolean): HostPolicy {
  const listed = options.blocked ?? []
  const telemetry = options.telemetry === "passthrough" ? [] : TELEMETRY_HOSTS
  const allow = options.allow ?? []
  /* An explicit `blocked` entry wins over this machine; `allow` wins over everything. */
  const isAllowed = (host: string) =>
    matchesAny(allow, host) || (isLoopback(host) && !matchesAny(listed, host))
  const isBlocked = (host: string) =>
    !isAllowed(host) && (matchesAny(listed, host) || matchesAny(telemetry, host))
  const unmatched = options.unmatched ?? "passthrough"
  const upstreams = socketUpstreams(options.routes)
  const assets = options.assets ?? "passthrough"
  const passesAsAsset = (host: string, kind: LoadKind | undefined, method: string) =>
    assets === "passthrough" && method === "GET" && isAssetKind(kind) && !isBlocked(host)

  return {
    isRouted,
    isBlocked,
    isAllowed,
    passesAsAsset,
    unmatched,
    upstreamOf: (host) => upstreams.find((route) => route.matches(host))?.upstream,
    dispositionOf(host, kind, method = "GET") {
      if (isRouted(host)) return "routed"
      if (isAllowed(host) || passesAsAsset(host, kind, method)) return "passthrough"

      return unmatched === "block" || isBlocked(host) ? "blocked" : "passthrough"
    },
  }
}

/** An unrouted request that passes while `unmatched` is `block`: an allowed host, or a page asset. */
function passesBlock(hosts: HostPolicy, req: CompletedRequest): boolean {
  const host = req.destination.hostname

  return (
    hosts.isAllowed(host) || hosts.passesAsAsset(host, loadKind(req.path, req.headers), req.method)
  )
}

/**
 * The rules for hosts no route answers: blocked ones get 502, this machine and allowed hosts pass
 * through, and the rest pass through or get 502 as `unmatched` says.
 */
async function placeUnrouted(server: Mockttp, options: ProxyOptions, hosts: HostPolicy) {
  const unrouted = (req: CompletedRequest) => !hosts.isRouted(req.destination.hostname)

  await server
    .forAnyRequest()
    .matching((req) => unrouted(req) && hosts.isBlocked(req.destination.hostname))
    .always()
    .thenReply(502, "danwo proxy: host is blocked for this run")
  /* A port of this machine nobody listens on: say so, rather than fail inside the passthrough. */
  await server
    .forAnyRequest()
    .matching(
      async (req) =>
        unrouted(req) &&
        isLoopback(req.destination.hostname) &&
        !(await isListening(req.destination.hostname, req.destination.port)),
    )
    .always()
    .thenCallback((req) => ({
      statusCode: 502,
      body: nothingListening(req.destination.hostname, req.destination.port),
    }))

  if (options.unmatched !== "block") {
    await server.forUnmatchedRequest().thenPassThrough()

    return
  }

  await server
    .forAnyRequest()
    .matching((req) => unrouted(req) && passesBlock(hosts, req))
    .always()
    .thenPassThrough()
  await server
    .forUnmatchedRequest()
    .thenReply(502, "danwo proxy: host is not routed and passthrough is blocked")
}

/** Each route's WebSocket destination: its own `webSocket`, or its upstream's, as `ws(s)://`. */
function socketUpstreams(routes: readonly Route[]): SocketUpstream[] {
  return routes.flatMap((route) => {
    const target = "upstream" in route ? route.upstream.replace(/^http/, "ws") : route.webSocket

    if (target === undefined) return []

    const matches = (host: string) => route.hosts.some((pattern) => hostMatches(pattern, host))

    return [{ matches, upstream: target }]
  })
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
  const caBundlePath = join(dir, "ca-bundle.pem")

  await writeFile(caCertPath, ca.cert)
  await writeFile(caBundlePath, caBundle(ca.cert))

  const clock = createAppClock(dir)
  const preloadDir = join(dir, "preloaded")
  const shimDir = await writeNodeShim(dir)

  replaceSocketHelpers()

  const server = getLocal({ https: ca })
  const loud = quietDroppedClients()

  await server.start()
  acceptSocketUrls(server)

  const patterns = options.routes.flatMap((r) => r.hosts)
  const isRouted = (host: string) => patterns.some((pattern) => hostMatches(pattern, host))
  let faultRule: OutboundFaultRule | undefined
  /** Faults `failNext` armed, each with how many more calls it meets. */
  let armed: { match: (call: OutboundCall) => boolean; fault: OutboundFault; left: number }[] = []
  let callIndex = 0
  /** Counts `clear()` calls: a held call from an earlier run is dropped, not answered, in a later one. */
  let runIndex = 0

  /** The fault `failNext` armed for `call`, spent by one; undefined when none matches. */
  const takeArmed = (call: OutboundCall): OutboundFault | undefined => {
    const hit = armed.find((entry) => entry.left > 0 && entry.match(call))

    if (hit === undefined) return undefined
    hit.left -= 1
    armed = armed.filter((entry) => entry.left > 0)

    return hit.fault
  }

  const log = new Map<string, Exchange>()
  // The route handler can run before the exchange is logged; hold its fault label until then.
  const faultLabels = new Map<string, string>()

  // Requests a fault holds back, waiting to hear whether their client gives up on them.
  const giveUps = new Map<string, () => void>()

  function gaveUp(id: string): Promise<void> {
    return new Promise((resolve) => giveUps.set(id, resolve))
  }

  function labelFault(id: string, label: string): void {
    const exchange = log.get(id)

    if (exchange) exchange.fault = label
    else faultLabels.set(id, label)
  }

  /** `req` as a fault rule sees it, numbered among the calls rules have seen. */
  const callOf = (req: CompletedRequest): OutboundCall => ({
    host: req.destination.hostname,
    method: req.method,
    path: req.path,
    index: callIndex++,
  })

  async function handle(handler: Handler, req: CompletedRequest) {
    const call = callOf(req)

    return handleUnder(takeArmed(call) ?? faultRule?.(call), handler, req)
  }

  /** Answers `req` through `handler`, with `fault` applied and recorded when there is one. */
  async function handleUnder(
    fault: OutboundFault | AnswerHold | undefined,
    handler: Handler,
    req: CompletedRequest,
  ) {
    if (fault) labelFault(req.id, describeOutboundFault(fault))

    const run = runIndex

    try {
      return await answerUnder(fault, handler, req, gaveUp(req.id), () => runIndex !== run)
    } finally {
      giveUps.delete(req.id)
    }
  }

  /** The fault the rule picked for each page call to an app it was asked about, by request id. */
  const appCallFaults = new Map<string, OutboundFault | AnswerHold | undefined>()

  /**
   * Whether the fault rule picks a fault for `req`, a page's `fetch()` to an app on this machine.
   * mockttp asks every rule's matcher about every request, so each is asked once and remembered.
   */
  const faultsAppCall = (hosts: HostPolicy, req: CompletedRequest): boolean => {
    const host = req.destination.hostname
    const load = loadKind(req.path, req.headers)
    const disposition = hosts.dispositionOf(host, load, req.method)
    const client = clientOf(req.headers["user-agent"])

    if (!isPageCallToApp({ disposition, client, load, host })) return false
    if (!appCallFaults.has(req.id)) appCallFaults.set(req.id, faultRule?.(callOf(req)))

    return appCallFaults.get(req.id) !== undefined
  }

  /**
   * A page's `fetch()` to an app on this machine passes through as it is, unless the fault rule
   * picks a fault for it: the proxy then forwards it itself and applies the fault, as it does for
   * a routed call, so the matrix can fail the calls a single-page app makes to its own API.
   * `failNext` leaves these calls alone: it is for a test's provider calls.
   */
  async function placeAppCallFaults(hosts: HostPolicy) {
    await server
      .forAnyRequest()
      .matching((req) => faultsAppCall(hosts, req))
      .always()
      .thenCallback((req) => {
        const fault = appCallFaults.get(req.id)

        appCallFaults.delete(req.id)

        return handleUnder(fault, forwardTo(new URL(req.url).origin), req)
      })
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

  /* The preload's check, ahead of every route and left out of the record. */
  await server
    .forAnyRequest()
    .forHostname(PROBE_HOST)
    .always()
    .thenReply(204, "", { [PROBE_HEADER]: "1" })

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

  const hosts = hostPolicy(options, isRouted)

  await placeAppCallFaults(hosts)
  await placeUnrouted(server, options, hosts)

  const sockets = await handleSockets(server, hosts, socketUpstreams(options.routes))

  const waiters = new Set<() => void>()
  // Bodies are read off the event loop; an exchange counts as finished once its captures land.
  const capturing = new Set<Promise<void>>()
  const finished = () =>
    capturing.size === 0 &&
    [...log.values()].every((e) => e.stream === true || e.status !== null || e.aborted)

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

    if (host === PROBE_HOST) return

    const load = loadKind(req.path, req.headers)

    log.set(req.id, {
      id: req.id,
      host,
      method: req.method,
      path: req.path,
      disposition: hosts.dispositionOf(host, load, req.method),
      ...((isPageAsset(req.path) || isScriptHost(host) || isAssetKind(load)) && { asset: true }),
      ...(load && { load }),
      startedAt: new Date(req.timingEvents.startTime).toISOString(),
      client: clientOf(req.headers["user-agent"]),
      ...userField(req.headers["user-agent"]),
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
  /* A stream's headers arrive long before it ends, if it ever does: readiness stops waiting then. */
  await server.on("response-initiated", (res) => {
    const exchange = log.get(res.id)

    if (exchange && isStreaming(res.headers["content-type"])) {
      exchange.stream = true
      exchange.status = res.statusCode
      notify()
    }
  })
  await server.on("response", (res) => {
    const exchange = log.get(res.id)

    appCallFaults.delete(res.id)
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

    appCallFaults.delete(req.id)
    if (exchange) exchange.aborted = true
    giveUps.get(req.id)?.()
    notify()
  })

  const url = `http://127.0.0.1:${server.port}`

  return {
    url,
    caCert: ca.cert,
    caCertPath,
    caBundlePath,
    caSpki: await generateSPKIFingerprint(ca.cert),
    clock,
    env(base = process.env, envOptions = {}) {
      return proxyEnvironment(
        { url, caCertPath, caBundlePath, clock, preloadDir, shimDir },
        base,
        envOptions,
      )
    },
    preloaded: () => preloadedPids(preloadDir),
    unrouted: () => unroutedProcesses(preloadDir),
    exchanges: () => [...log.values()],
    sockets: () => sockets.sockets(),
    setFault(rule) {
      faultRule = rule
    },
    failNext(match, fault, times = 1) {
      armed.push({ match, fault, left: times })
    },
    setSocketFault(rule) {
      sockets.setFault(rule)
    },
    clear() {
      runIndex += 1
      armed = []
      log.clear()
      sockets.clear()
      faultLabels.clear()
      appCallFaults.clear()
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
      try {
        await server.stop()
        await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      } finally {
        loud()
      }
    },
  }
}
