/*
 * Loaded into the app under test with NODE_OPTIONS=--import. Node only routes its default agent
 * and fetch through HTTPS_PROXY (with NODE_USE_ENV_PROXY=1); SDKs that build their own agent, such
 * as the official Stripe client, would bypass the proxy. This makes every http/https Agent the app
 * creates use the proxy environment too. Agents that are proxy agents themselves (agent-base
 * subclasses such as https-proxy-agent, which gaxios builds from HTTPS_PROXY) are left as they
 * are: they already proxy, and Node's proxyEnv reads `protocol` before agent-base sets it up.
 */
import http from "node:http"
import https from "node:https"
import { syncBuiltinESMExports } from "node:module"

function definesProtocol(target, Base) {
  let proto = target.prototype

  while (proto && proto !== Base.prototype) {
    if (Object.getOwnPropertyDescriptor(proto, "protocol")?.get) return true
    proto = Object.getPrototypeOf(proto)
  }

  return false
}

for (const mod of [http, https]) {
  const Base = mod.Agent

  mod.Agent = class extends Base {
    constructor(options = {}) {
      super(definesProtocol(new.target, Base) ? options : { proxyEnv: process.env, ...options })
    }
  }
}

syncBuiltinESMExports()
