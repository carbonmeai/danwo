/*
 * Loaded into the app under test with NODE_OPTIONS=--import. It routes the app's HTTP through
 * danwo's proxy, checks that it did, and runs the app's clock.
 *
 * Routing. Node 22.21 and later on the 22 line, and 24.5 and later, route fetch and their default
 * agents through HTTPS_PROXY themselves (with NODE_USE_ENV_PROXY=1); SDKs that build their own
 * agent, such as the official Stripe client, would still bypass the proxy, so every http/https
 * Agent the app creates gets the proxy environment too. Agents that are proxy agents themselves
 * (agent-base subclasses such as https-proxy-agent, which gaxios builds from HTTPS_PROXY) are left
 * as they are: they already proxy, and Node's proxyEnv reads `protocol` before agent-base sets
 * it up. Older Nodes ignore NODE_USE_ENV_PROXY and `proxyEnv` (24.0 to 24.4 honour it for fetch
 * only), so there the preload tunnels through the proxy itself: every Agent's connections, and
 * fetch's, go through a CONNECT to the proxy unless NO_PROXY names the host.
 *
 * The check. Before the app's own code runs, the preload calls the proxy's probe host with fetch,
 * an https.Agent and an http.Agent. Only a process whose three calls reached the proxy counts as
 * routed in its heartbeat; one that did not says why on stderr, and exits when the run requires
 * the proxy (DANWO_REQUIRE_PROXY=1), before it can call a real provider.
 *
 * Bun loads it with `--preload` (from BUN_OPTIONS); Bun honours HTTPS_PROXY on its own, so there
 * only the clock and the heartbeat apply.
 *
 * When DANWO_TIME_FILE is set, `Date` runs ahead of real time by the offset in that file, which
 * the runner moves to travel in time. Timers and `performance.now()` stay on real time: sockets,
 * retries and pools keep measuring real durations. A new offset is acknowledged by writing it to
 * `<file>.acks/<pid>`, so the runner knows every app process has taken it.
 *
 * Imported with `?inspect` in its URL, it only exports its helpers, for tests.
 */
import { mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import http from "node:http"
import https from "node:https"
import Module, { syncBuiltinESMExports } from "node:module"
import net from "node:net"
import { basename, dirname, join } from "node:path"
import tls from "node:tls"
import { fileURLToPath } from "node:url"
import { isMainThread } from "node:worker_threads"

/** The header the proxy's probe host answers with. */
const PROBE_HEADER = "x-danwo-probe"

/** How long each probe call may take before the process counts as not routed. */
const PROBE_TIMEOUT_MS = 5_000

/** How often the clock file is looked at, besides its watch events, for an offset not yet taken. */
const CLOCK_POLL_MS = 250

/** What this Node routes through HTTPS_PROXY by itself, from its version (`22.18.0`). */
export function nativeProxySupport(version) {
  const [major = 0, minor = 0] = version.split(".").map(Number)
  const line22 = major === 22 && minor >= 21

  return {
    fetch: major >= 24 || line22,
    agents: major > 24 || (major === 24 && minor >= 5) || line22,
  }
}

/** `host` without IPv6 brackets, lowercased. */
function bareHost(host) {
  return host.replace(/^\[(.*)\]$/, "$1").toLowerCase()
}

/** One NO_PROXY entry as a host suffix and an optional port: `.example.com`, `[::1]:8080`. */
function noProxyEntry(entry) {
  const bracketed = /^\[(.+)\](?::(\d+))?$/.exec(entry)
  const [host, port] = bracketed
    ? [bracketed[1], bracketed[2]]
    : entry.split(":").length === 2
      ? entry.split(":")
      : [entry, undefined]

  return { host: bareHost(host).replace(/^\*?\./, ""), port }
}

/** Whether `noProxy` (NO_PROXY's value) sends `host:port` straight to the host. */
export function bypassesProxy(host, port, noProxy = "") {
  const name = bareHost(host)

  return noProxy
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((raw) => {
      if (raw === "*") return true

      const entry = noProxyEntry(raw)

      return (
        (entry.port === undefined || entry.port === String(port)) &&
        (name === entry.host || name.endsWith(`.${entry.host}`))
      )
    })
}

/** The proxy URL a request for `host:port` goes through, or undefined when it goes direct. */
function proxyFor(secure, host, port, env = process.env) {
  const url = secure ? (env.HTTPS_PROXY ?? env.https_proxy) : (env.HTTP_PROXY ?? env.http_proxy)

  return url && !bypassesProxy(host, port, env.NO_PROXY ?? env.no_proxy) ? url : undefined
}

/** A raw socket to `host:port` through the proxy at `proxyUrl`, by CONNECT. */
function tunnel(proxyUrl, host, port, callback) {
  const proxy = new URL(proxyUrl)
  const target = `${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`
  const socket = net.connect(Number(proxy.port) || 80, bareHost(proxy.hostname))
  let head = Buffer.alloc(0)
  let done = false

  const finish = (error) => {
    if (done) return
    done = true
    socket.off("data", read).off("error", finish).off("close", closed)
    if (error) {
      socket.destroy()
      callback(error)
    } else callback(null, socket)
  }

  const read = (chunk) => {
    head = Buffer.concat([head, chunk])

    const end = head.indexOf("\r\n\r\n")

    if (end === -1) return

    const status = /^HTTP\/1\.[01] (\d{3})/.exec(head.subarray(0, end).toString("latin1"))?.[1]
    const rest = head.subarray(end + 4)

    if (status !== "200") return finish(new Error(`danwo's proxy refused CONNECT ${target}`))
    if (rest.length > 0) socket.unshift(rest)
    finish()
  }

  const closed = () => finish(new Error(`danwo's proxy closed CONNECT ${target}`))

  socket.once("connect", () =>
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`),
  )
  socket.on("data", read)
  socket.once("error", finish)
  socket.once("close", closed)
}

function definesProtocol(target, Base) {
  let proto = target.prototype

  while (proto && proto !== Base.prototype) {
    if (Object.getOwnPropertyDescriptor(proto, "protocol")?.get) return true
    proto = Object.getPrototypeOf(proto)
  }

  return false
}

/** Agents Node proxies by itself: each gets the proxy environment, unless it proxies already. */
function nativeAgents(Base) {
  return class extends Base {
    constructor(options = {}) {
      super(definesProtocol(new.target, Base) ? options : { proxyEnv: process.env, ...options })
    }
  }
}

/** Agents whose connections go through a CONNECT tunnel to the proxy, for Nodes without it. */
function tunnelledAgents(Base, secure) {
  return class extends Base {
    constructor(options = {}) {
      super(options)
      if (definesProtocol(new.target, Base)) return

      const own = this.createConnection

      this.createConnection = (connection, callback) => {
        const host = connection.host ?? connection.hostname ?? "localhost"
        const port = connection.port ?? (secure ? 443 : 80)
        const via = proxyFor(secure, host, port)

        if (via === undefined) return own.call(this, connection, callback)

        tunnel(via, host, port, (error, socket) => {
          if (error) callback(error)
          else callback(null, secure ? own.call(this, { ...connection, socket }) : socket)
        })

        return undefined
      }
    }
  }
}

function proxyAgents(native) {
  for (const [mod, secure] of [
    [http, false],
    [https, true],
  ]) {
    const Base = mod.Agent

    mod.Agent = native ? nativeAgents(Base) : tunnelledAgents(Base, secure)
    /* Node proxies its own default agents; on older Nodes they are replaced by tunnelled ones. */
    if (!native) mod.globalAgent = new mod.Agent({ ...mod.globalAgent.options })
  }

  syncBuiltinESMExports()
}

/** A connection for fetch's dispatcher: tunnelled through the proxy, or direct under NO_PROXY. */
function connectFetch(options, callback) {
  const secure = options.protocol === "https:"
  const host = options.hostname
  const port = Number(options.port) || (secure ? 443 : 80)
  const servername = options.servername ?? (net.isIP(bareHost(host)) ? undefined : host)
  let called = false

  const once = (error, socket) => {
    if (called) return
    called = true
    callback(error, error ? null : socket)
  }

  const secured = (socket) =>
    tls
      .connect({ socket, host: bareHost(host), port, servername, ALPNProtocols: ["http/1.1"] })
      .once("secureConnect", function () {
        once(null, this)
      })
      .once("error", once)

  const via = proxyFor(secure, host, port)

  if (via !== undefined)
    return tunnel(via, host, port, (error, socket) =>
      error ? once(error) : secure ? secured(socket) : once(null, socket),
    )

  const socket = net.connect(port, bareHost(host)).setNoDelay(true)

  socket.once("error", once)
  if (secure) secured(socket)
  else socket.once("connect", () => once(null, socket))
}

/**
 * fetch on Nodes that do not proxy it: its global dispatcher, an Agent of Node's bundled undici
 * (reached through the dispatcher Node creates once `Response` is touched), becomes one that
 * connects through `connectFetch`.
 */
function proxyFetch() {
  const key = Symbol.for("undici.globalDispatcher.1")

  void globalThis.Response
  const Agent = globalThis[key]?.constructor

  if (typeof Agent === "function") globalThis[key] = new Agent({ connect: connectFetch })
}

function shiftClock(file) {
  const RealDate = globalThis.Date
  const acks = `${file}.acks`
  const ack = join(acks, String(process.pid))
  let offset = 0

  /**
   * Takes the file's offset and acknowledges it. A write empties the file before it fills it, and
   * a watch event can land in between: an empty read keeps the last offset and waits for the next.
   */
  const load = () => {
    try {
      const text = readFileSync(file, "utf8").trim()

      if (text === "") return
      offset = Number(text) || 0
      mkdirSync(acks, { recursive: true })
      writeFileSync(ack, String(offset))
    } catch {
      /* The run that owned the file has ended; keep the last offset. */
    }
  }

  /** Whether the file holds an offset this process has not taken, for when a watch event is missed. */
  const stale = () => {
    try {
      const text = readFileSync(file, "utf8").trim()

      return text !== "" && (Number(text) || 0) !== offset
    } catch {
      return false
    }
  }

  function ShiftedDate(...args) {
    if (!new.target) return new RealDate(RealDate.now() + offset).toString()

    return Reflect.construct(
      RealDate,
      args.length === 0 ? [RealDate.now() + offset] : args,
      new.target,
    )
  }

  Object.setPrototypeOf(ShiftedDate, RealDate)
  /*
   * `Date.UTC` and `Date.parse` as own properties too, not only through the prototype chain:
   * frameworks that wrap `Date` (Next.js does) copy its own statics, and drop inherited ones.
   */
  for (const name of Object.getOwnPropertyNames(RealDate))
    if (!["length", "name", "prototype"].includes(name))
      Object.defineProperty(ShiftedDate, name, Object.getOwnPropertyDescriptor(RealDate, name))
  ShiftedDate.prototype = RealDate.prototype
  ShiftedDate.now = () => RealDate.now() + offset
  RealDate.prototype.constructor = ShiftedDate
  globalThis.Date = ShiftedDate
  load()
  watch(dirname(file), (_event, name) => {
    if (name === basename(file)) load()
  }).unref()
  /* Watchers can merge or drop events (Bun's on Linux does), so a slow look catches what they miss. */
  setInterval(() => {
    if (stale()) load()
  }, CLOCK_POLL_MS).unref()
  process.once("exit", () => rmSync(ack, { force: true }))
}

/** undici's entry point, however the app's package manager lays out node_modules. */
const UNDICI_ENTRY = /[\\/]node_modules[\\/]undici[\\/]index\.js$/

/** Appended to undici's entry point: its `Agent` becomes the proxy-aware one. */
const UNDICI_AGENT =
  "\n;module.exports.Agent = class Agent extends module.exports.EnvHttpProxyAgent {};\n"

/*
 * undici's own `Agent`, which an app can hand to fetch as its dispatcher, ignores HTTPS_PROXY.
 * When the app loads undici (by `require` or `import`), its `Agent` becomes `EnvHttpProxyAgent`,
 * which takes the same options and goes through the proxy.
 */
function proxyUndici() {
  if (typeof Module.registerHooks !== "function") return

  Module.registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context)

      if (!url.startsWith("file:") || !UNDICI_ENTRY.test(fileURLToPath(url))) return loaded

      const source =
        typeof loaded.source === "string" ? loaded.source : new TextDecoder().decode(loaded.source)

      return { ...loaded, source: `${source}${UNDICI_AGENT}` }
    },
  })
}

/** Why a probe call did not reach the proxy, in a few words. */
function failure(error) {
  const cause = error?.cause ?? error

  return cause?.code ?? cause?.message ?? String(cause)
}

/** Calls `url` with Node's http or https module and a fresh agent, resolving with the probe header. */
function probeWithAgent(mod, url) {
  const agent = new mod.Agent()

  return new Promise((resolve, reject) => {
    const request = mod.get(url, { agent, timeout: PROBE_TIMEOUT_MS }, (response) => {
      response.resume()
      resolve(response.headers[PROBE_HEADER])
    })

    request.once("timeout", () => request.destroy(new Error("timed out")))
    request.once("error", reject)
  }).finally(() => agent.destroy())
}

/**
 * Whether `probe` reaches the proxy, by the name of each way of calling it; a value other than
 * `true` says what happened instead.
 */
async function probeRouting(probe) {
  const secure = new URL(probe)
  const plain = new URL(probe)

  secure.protocol = "https:"
  plain.protocol = "http:"

  const calls = {
    fetch: () =>
      fetch(secure, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }).then((response) =>
        response.arrayBuffer().then(() => response.headers.get(PROBE_HEADER)),
      ),
    "https.Agent": () => probeWithAgent(https, secure),
    "http.Agent": () => probeWithAgent(http, plain),
  }
  const results = await Promise.all(
    Object.entries(calls).map(async ([name, call]) => {
      try {
        const header = await call()

        return [name, header === "1" ? true : "answered, but not by danwo's proxy"]
      } catch (error) {
        return [name, failure(error)]
      }
    }),
  )

  return Object.fromEntries(results)
}

/** The calls of `probeRouting`'s results that missed the proxy, as `fetch (ENOTFOUND)`; empty when none did. */
export function missedProbes(results) {
  return Object.entries(results)
    .filter(([, result]) => result !== true)
    .map(([name, result]) => `${name} (${result})`)
}

/**
 * What a process that is not routed says on stderr: which calls missed, on which Node, and the
 * fix. `version` is `process.version`, `v22.18.0`.
 */
export function unroutedMessage(pid, version, missed) {
  return `danwo: process ${pid} runs Node ${version}, and its calls do not go through danwo's proxy (${missed.join(", ")} missed it): they would reach the real providers. ${routingFix(version)}`
}

/** What to do about a process on Node `version` (`v22.18.0`) whose calls missed the proxy. */
export function routingFix(version) {
  const native = nativeProxySupport(version.replace(/^v/, ""))

  return native.fetch && native.agents
    ? "Check that NO_PROXY does not name every host, and that nothing in the app replaces HTTPS_PROXY or NODE_USE_ENV_PROXY."
    : "This Node does not route through a proxy itself, and danwo's own routing did not take: run the app on Node 22.21 or later on the 22 line, or 24.5 or later (check the folder's .nvmrc, volta, mise or asdf pin, and any script that calls a specific node), and check NO_PROXY."
}

/*
 * A file named after this process in DANWO_PRELOAD_DIR, so the runner can tell which of the app's
 * Node processes run with the proxy and which lost it (a start script that sets its own
 * NODE_OPTIONS drops the preload). It says whether the probe reached the proxy: a process that is
 * not routed keeps its file after it exits, so the runner can name it even then.
 */
function heartbeat(dir, record) {
  const file = join(dir, String(process.pid))

  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify(record))
    if (record.routed) process.once("exit", () => rmSync(file, { force: true }))
  } catch {
    /* The run that owned the folder has ended. */
  }
}

/** Sends the process's HTTP through the proxy: Node's own way where it has one, tunnels elsewhere. */
function route(env) {
  /* DANWO_PRELOAD_TUNNEL=1 tunnels on any Node, as on one without proxy support: for tests. */
  const native =
    env.DANWO_PRELOAD_TUNNEL === "1"
      ? { fetch: false, agents: false }
      : nativeProxySupport(process.versions.node)

  proxyAgents(native.agents)
  if (!native.fetch) proxyFetch()
  proxyUndici()
}

/**
 * Checks that the process's calls reach the proxy and leaves its heartbeat. A process that misses
 * says so, and exits when the run requires the proxy.
 */
async function check(env, probe) {
  const record = { routed: true, node: process.version, command: process.argv.slice(1).join(" ") }
  const missed = probe ? missedProbes(await probeRouting(probe)) : []

  if (missed.length > 0) {
    const stop = env.DANWO_REQUIRE_PROXY === "1"
    const stopped = stop ? " danwo stops it: this run requires every call to go through it." : ""

    Object.assign(record, { routed: false, missed, fix: routingFix(process.version) })
    process.stderr.write(`${unroutedMessage(process.pid, process.version, missed)}${stopped}\n`)
  }

  if (env.DANWO_PRELOAD_DIR) heartbeat(env.DANWO_PRELOAD_DIR, record)
  if (!record.routed && env.DANWO_REQUIRE_PROXY === "1") process.exit(1)
}

if (new URL(import.meta.url).search !== "?inspect") {
  const bun = Boolean(process.versions.bun)

  if (!bun) route(process.env)
  if (process.env.DANWO_TIME_FILE) shiftClock(process.env.DANWO_TIME_FILE)
  if (isMainThread) await check(process.env, bun ? undefined : process.env.DANWO_PROXY_PROBE)
}
