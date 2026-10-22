/**
 * Binds an iOS Simulator to danwo's proxy for a run: the run's CA in the simulator's trust store,
 * and the simulator's own system proxy pointed at danwo's. The simulator shares the Mac's
 * loopback, so the proxy on 127.0.0.1 needs no forwarding. Nothing on the Mac changes.
 *
 * The proxy setting lives in the simulator's memory: a reboot clears it, and the simulator may copy
 * the Mac's setting over it when the Mac's network changes. So `ensure` writes it again before each
 * attempt, and `unbind` puts back what was there before the run.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  type ProxySettings,
  proxiedSettings,
  proxiesThrough,
  type SimulatorProxy,
} from "./proxy-helper.ts"
import type { SimulatorTool } from "./simctl.ts"

/** The proxy's address as the simulator reaches it: the Mac's loopback. */
const PROXY_HOST = "127.0.0.1"

const PROXY_KEYS = ["HTTPEnable", "HTTPProxy", "HTTPPort", "HTTPSEnable", "HTTPSProxy", "HTTPSPort"]

/**
 * `settings` with no proxy on this Mac's loopback: one there is a run's, and maybe a run that
 * ended without unbinding, never the setting to go back to.
 */
export function withoutLoopbackProxy(settings: ProxySettings): ProxySettings {
  if (settings.HTTPProxy !== PROXY_HOST && settings.HTTPSProxy !== PROXY_HOST) return settings

  return Object.fromEntries(Object.entries(settings).filter(([key]) => !PROXY_KEYS.includes(key)))
}

/** What the binder needs from the run. */
export interface IosBindOptions {
  /** The run's CA certificate, PEM. */
  readonly caCert: string
  /** The proxy's port on the Mac. */
  readonly proxyPort: number
}

/** Binds, re-applies and unbinds one simulator. */
export class IosBinder {
  private readonly tool: SimulatorTool
  private readonly proxy: SimulatorProxy
  private readonly options: IosBindOptions
  /** The simulator's proxy entry before the run, put back by `unbind`. */
  private before: ProxySettings | undefined

  constructor(tool: SimulatorTool, proxy: SimulatorProxy, options: IosBindOptions) {
    this.tool = tool
    this.proxy = proxy
    this.options = options
  }

  /** The run's CA as a trusted root for every process in the simulator. */
  private async trustCa(): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "danwo-ca-"))
    const file = join(dir, "danwo-ca.pem")

    try {
      await writeFile(file, this.options.caCert)
      await this.tool.on("keychain", ["add-root-cert", file])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** The simulator's proxy through danwo's, checked by reading it back. */
  async ensure(): Promise<void> {
    const { proxyPort } = this.options
    const current = await this.proxy.read()

    this.before ??= withoutLoopbackProxy(current)
    if (proxiesThrough(current, PROXY_HOST, proxyPort)) return

    const written = await this.proxy.write(proxiedSettings(this.before, PROXY_HOST, proxyPort))

    if (!proxiesThrough(written, PROXY_HOST, proxyPort)) {
      throw new Error(
        `the simulator ${this.tool.udid} did not take the proxy setting (it holds ${JSON.stringify(written)})`,
      )
    }
  }

  /** The CA, then the proxy. */
  async bind(): Promise<void> {
    await this.trustCa()
    await this.ensure()
  }

  /** After a reboot: the proxy again (the CA is kept on disk), and this run's CA in case it changed. */
  async rebind(): Promise<void> {
    await this.trustCa()
    await this.ensure()
  }

  /** The simulator's proxy as it was before the run. */
  async unbind(): Promise<void> {
    if (this.before !== undefined) await this.proxy.write(this.before).catch(() => undefined)
  }
}
