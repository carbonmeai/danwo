/*
 * Loaded into the app under test with NODE_OPTIONS=--import. Node only routes its default agent
 * and fetch through HTTPS_PROXY (with NODE_USE_ENV_PROXY=1); SDKs that build their own agent, such
 * as the official Stripe client, would bypass the proxy. This makes every http/https Agent the app
 * creates use the proxy environment too. Agents that are proxy agents themselves (agent-base
 * subclasses such as https-proxy-agent, which gaxios builds from HTTPS_PROXY) are left as they
 * are: they already proxy, and Node's proxyEnv reads `protocol` before agent-base sets it up.
 *
 * Bun loads it with `--preload` (from BUN_OPTIONS); Bun honours HTTPS_PROXY on its own, so there
 * only the clock below applies.
 *
 * When DANWO_TIME_FILE is set, `Date` runs ahead of real time by the offset in that file, which
 * the runner moves to travel in time. Timers and `performance.now()` stay on real time: sockets,
 * retries and pools keep measuring real durations. A new offset is acknowledged by writing it to
 * `<file>.acks/<pid>`, so the runner knows every app process has taken it.
 */
import { mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import http from "node:http"
import https from "node:https"
import { syncBuiltinESMExports } from "node:module"
import { basename, dirname, join } from "node:path"

function definesProtocol(target, Base) {
  let proto = target.prototype

  while (proto && proto !== Base.prototype) {
    if (Object.getOwnPropertyDescriptor(proto, "protocol")?.get) return true
    proto = Object.getPrototypeOf(proto)
  }

  return false
}

function proxyAgents() {
  for (const mod of [http, https]) {
    const Base = mod.Agent

    mod.Agent = class extends Base {
      constructor(options = {}) {
        super(definesProtocol(new.target, Base) ? options : { proxyEnv: process.env, ...options })
      }
    }
  }

  syncBuiltinESMExports()
}

function shiftClock(file) {
  const RealDate = globalThis.Date
  const acks = `${file}.acks`
  const ack = join(acks, String(process.pid))
  let offset = 0

  const load = () => {
    try {
      offset = Number(readFileSync(file, "utf8")) || 0
      mkdirSync(acks, { recursive: true })
      writeFileSync(ack, String(offset))
    } catch {
      /* The run that owned the file has ended; keep the last offset. */
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
  ShiftedDate.prototype = RealDate.prototype
  ShiftedDate.now = () => RealDate.now() + offset
  RealDate.prototype.constructor = ShiftedDate
  globalThis.Date = ShiftedDate
  load()
  watch(dirname(file), (_event, name) => {
    if (name === basename(file)) load()
  }).unref()
  process.once("exit", () => rmSync(ack, { force: true }))
}

if (!process.versions.bun) proxyAgents()
if (process.env.DANWO_TIME_FILE) shiftClock(process.env.DANWO_TIME_FILE)
