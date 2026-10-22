/**
 * A project whose environment is an iOS Simulator with its Settings app in front, behind danwo's
 * proxy: nothing to build, so a device session can be tried on a real simulator in minutes. The
 * simulator is the one `DANWO_MCP_SIMULATOR` names, created on first use and deleted on close.
 * Settings is part of the system, so it has no data of its own to clear: each start relaunches it.
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { IOS_BACKGROUND_HOSTS, withIosDevice } from "@danwo/mobile"
import type { DeviceTarget } from "@danwo/runner/runner"
import { defineConfig, startServices } from "@danwo/sdk"

const SETTINGS = "com.apple.Preferences"
const run = promisify(execFile)

export default defineConfig({
  async environment() {
    const services = await startServices([], { blocked: IOS_BACKGROUND_HOSTS })
    const env = await withIosDevice(
      { proxy: services.proxy, fixtures: services.fixtures, close: () => services.close() },
      {
        name: process.env.DANWO_MCP_SIMULATOR ?? "danwo mcp iPhone",
        remove: true,
        /* A simulator's first boot migrates its data, which can take minutes. */
        bootTimeoutMs: 600_000,
        app: { bundleId: SETTINGS },
      },
    )
    const { device } = env
    const settings: DeviceTarget = {
      platform: "ios",
      app: SETTINGS,
      async startApp() {
        await run("xcrun", [
          "simctl",
          "launch",
          "--terminate-running-process",
          device.udid,
          SETTINGS,
        ])

        return { relaunched: undefined }
      },
      openLink: (url) => device.openLink(url),
      read: () => device.read(),
      foreground: () => device.foreground(),
      tap: (ref) => device.tap(ref),
      fill: (ref, text) => device.fill(ref, text),
      back: () => device.back(),
      scroll: (direction, within) => device.scroll(direction, within),
      pressKey: (key) => device.pressKey(key),
      tapAt: (x, y) => device.tapAt(x, y),
      screenshot: (path) => device.screenshot(path),
      logs: () => device.logs(),
      recordScreen: (path) => device.recordScreen(path),
    }

    return { ...env, device: settings, close: () => env.close() }
  },
})
