/**
 * Binds an emulator to danwo's proxy for a run, so the app's and the browser's traffic reach the
 * emulators: root, the run's CA in the user trust store, Chrome's first-run screens out of the way,
 * the network probe that would mark the proxied network broken switched off, and the device's
 * proxy pointed (through `adb reverse`) at danwo's. `rebind` redoes what an adbd restart or a
 * snapshot load loses; `unbind` leaves the device as it was, so a stale proxy setting never kills
 * its network after the run. A shared device (a remote one) also gets back the settings it had, an
 * adbd that is not root, and loses the CA and Chrome flags danwo added.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Adb } from "../adb.ts"
import { androidCaFileName } from "./ca.ts"

/** How many times `adb root` is tried, and the pause between tries. */
const ROOT_ATTEMPTS = 5
const ROOT_RETRY_MS = 1_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The port the device talks to; `adb reverse` maps it to the run's proxy on the host. */
export const DEVICE_PROXY_PORT = 8765

const CA_DIR = "/data/misc/user/0/cacerts-added"
const CHROME = "com.android.chrome"
const CHROME_FLAGS =
  "chrome --disable-fre --no-default-browser-check --no-first-run --disable-background-networking"

/** What the binder needs from the run. */
export interface BindOptions {
  /** The run's CA certificate, PEM. */
  readonly caCert: string
  /** The proxy's port on the host. */
  readonly proxyPort: number
  /** More ports the device reaches on the host at the same number, e.g. a dev server's. */
  readonly reverse?: readonly number[]
  /**
   * Whether the device outlives the run and others use it (a remote one): `unbind` then removes the
   * CA and Chrome's flags and puts back the settings the binder changed.
   */
  readonly restore?: boolean
  /** Connects to the device again after `adb root` restarts adbd, which drops a network connection. */
  readonly reconnect?: () => Promise<void>
}

/** The global settings the binder changes. */
const QUIET_SETTINGS = [
  "window_animation_scale",
  "transition_animation_scale",
  "animator_duration_scale",
  "captive_portal_mode",
] as const

/** Whether adb said this device's adbd cannot run as root at all. */
function rootRefused(said: string): boolean {
  return /production builds|cannot run as root/i.test(said)
}

/** Runs adb commands to bind, rebind and unbind one device. */
export class AndroidBinder {
  private readonly adb: Adb
  private readonly options: BindOptions
  /** The settings' values before the binder changed them, for a shared device. */
  private saved: ReadonlyMap<string, string> | undefined
  /** Whether the run's CA and Chrome's flags are on the device, for a shared device's unbind. */
  private trusted = false
  private chromePrepared = false
  /** Whether the binder restarted adbd as root, which a shared device's unbind undoes. */
  private rooted = false

  constructor(adb: Adb, options: BindOptions) {
    this.adb = adb
    this.options = options
  }

  /** Root, unless adbd is root already (a no-op then, which keeps every forwarding rule). */
  private async root(): Promise<void> {
    if (await this.adb.isRoot()) return

    /*
     * Just after a boot adbd can drop the request ("unable to connect for root"), and a restarted
     * adbd answers before it runs as root; so ask again until `id -u` says 0.
     */
    let failure: unknown

    for (let attempt = 1; attempt <= ROOT_ATTEMPTS; attempt++) {
      try {
        const said = await this.adb.run(["root"])

        if (rootRefused(said)) throw new Error(said.trim())
        await this.options.reconnect?.()
        await this.adb.waitForDevice()

        if (await this.adb.isRoot()) {
          this.rooted = true

          return
        }
      } catch (error) {
        if (error instanceof Error && rootRefused(error.message)) throw this.unrootable(error)
        failure = error
      }

      await sleep(ROOT_RETRY_MS)
      await this.options.reconnect?.().catch(() => undefined)
      await this.adb.waitForDevice().catch(() => undefined)
    }

    throw new Error(`${this.adb.serial} did not run adbd as root after ${ROOT_ATTEMPTS} tries`, {
      cause: failure,
    })
  }

  /** The error for a device whose adbd cannot run as root (a production build). */
  private unrootable(cause: Error): Error {
    return new Error(
      `${this.adb.serial} cannot run adbd as root, which danwo needs to add its CA to the device's trust store: use an emulator image or a rooted (userdebug) device, as most device clouds' virtual devices are`,
      { cause },
    )
  }

  /** The run's CA's path on the device. */
  private get caPath(): string {
    return `${CA_DIR}/${androidCaFileName(this.options.caCert)}`
  }

  /** The run's CA into the user trust store, readable by the system like a CA a user added. */
  private async trustCa(): Promise<void> {
    const name = androidCaFileName(this.options.caCert)
    const target = this.caPath
    const dir = await mkdtemp(join(tmpdir(), "danwo-ca-"))
    const local = join(dir, name)

    try {
      await writeFile(local, this.options.caCert)
      await this.adb.shell(`mkdir -p ${CA_DIR}`)
      await this.adb.run(["push", local, target])
      await this.adb.shell(
        `chown system:system ${target} && chmod 644 ${target} && restorecon ${target}`,
      )
      this.trusted = true
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }

  /** Chrome opens straight to the page: no welcome screens, no notification prompt. */
  private async prepareChrome(): Promise<void> {
    this.chromePrepared = true
    await this.adb.shell(`am set-debug-app --persistent ${CHROME}`).catch(() => undefined)
    await this.adb.shell(`echo '${CHROME_FLAGS}' > /data/local/tmp/chrome-command-line`)
    await this.adb
      .shell(`pm grant ${CHROME} android.permission.POST_NOTIFICATIONS`)
      .catch(() => undefined)
  }

  /** Steady screens: no animations, and no network probe that fails on danwo's certificate. */
  private async quietDevice(): Promise<void> {
    if (this.options.restore === true && this.saved === undefined) {
      const saved = new Map<string, string>()

      for (const name of QUIET_SETTINGS)
        saved.set(name, await this.adb.shell(`settings get global ${name}`))
      this.saved = saved
    }

    for (const name of QUIET_SETTINGS) await this.adb.shell(`settings put global ${name} 0`)
  }

  /** The device's proxy setting and the reverse rule that carries it to the host. */
  private async routeThroughProxy(): Promise<void> {
    await this.adb.run(["reverse", `tcp:${DEVICE_PROXY_PORT}`, `tcp:${this.options.proxyPort}`])
    for (const port of this.options.reverse ?? [])
      await this.adb.run(["reverse", `tcp:${port}`, `tcp:${port}`])
    await this.adb.shell(`settings put global http_proxy 127.0.0.1:${DEVICE_PROXY_PORT}`)
  }

  /** Everything, in the order that works: root first, the proxy route last. */
  async bind(): Promise<void> {
    await this.root()
    await this.trustCa()
    await this.prepareChrome()
    await this.quietDevice()
    await this.routeThroughProxy()
  }

  /**
   * After an adbd restart, a reboot or a snapshot load: root again if needed, this run's CA (a
   * snapshot holds the CA of the run that saved it), and the reverse rule, which none of them keep.
   */
  async rebind(): Promise<void> {
    await this.root()
    await this.trustCa()
    await this.routeThroughProxy()
  }

  /**
   * The device's network as it was: no proxy setting, no reverse rules. A shared device also loses
   * the run's CA and Chrome's flags, and gets its settings back (a setting it never had is deleted).
   */
  async unbind(): Promise<void> {
    const quietly = (command: string) => this.adb.shell(command).catch(() => "")

    await quietly("settings put global http_proxy :0")
    await this.adb.run(["reverse", "--remove-all"]).catch(() => undefined)

    if (this.options.restore !== true) return

    if (this.trusted) await quietly(`rm -f ${this.caPath}`)

    if (this.chromePrepared) {
      await quietly("am clear-debug-app")
      await quietly("rm -f /data/local/tmp/chrome-command-line")
    }

    this.trusted = false
    this.chromePrepared = false

    for (const [name, value] of this.saved ?? []) {
      await quietly(
        value === "" || value === "null"
          ? `settings delete global ${name}`
          : `settings put global ${name} ${value}`,
      )
    }

    this.saved = undefined

    if (this.rooted) {
      /* Back to the shell user; restarting adbd drops a network connection, so connect again. */
      await this.adb.run(["unroot"]).catch(() => undefined)
      await this.options.reconnect?.().catch(() => undefined)
      this.rooted = false
    }
  }
}
