import { fileURLToPath } from "node:url"

import { IOS_BACKGROUND_HOSTS, iosWorkers, withIosDevice } from "@danwo/device"
import { buildIos } from "@danwo/expo"
import { defineConfig } from "@danwo/sdk"

import { waitlistBackend } from "./tests/stack/api.ts"

/** The Xcode project in `ios/`: `danwo build-ios ios` builds it for the simulator and keeps the build. */
const APP = fileURLToPath(new URL("./ios", import.meta.url))

export default defineConfig({
  testDir: "tests",
  /* Each worker boots its own simulator: as many as this Mac has room for, at most three. */
  workers: iosWorkers(),
  timeout: 120_000,
  /* The model agent steps run on. Its key is read from AI_GATEWAY_API_KEY; without one they skip. */
  model: "anthropic/claude-sonnet-5",
  /* Verified agent steps are kept here and replayed with no model call; git ignores the folder. */
  cache: { dir: ".danwo/cache" },
  /* After each tap, wait for the screen and for the calls it caused behind the app. */
  readiness: { mode: "page+backend", settle: true },
  /*
   * Each worker gets its own database, Resend emulator and API, and its own simulator bound to the
   * same proxy: the simulator's proxy setting and danwo's CA carry the app's HTTPS calls to the
   * worker's API with no change to the app. Every test starts the app afresh.
   */
  async environment({ workerIndex }) {
    /* An unchanged app reuses its kept build. */
    const build = await buildIos({ project: APP })
    const backend = await waitlistBackend(workerIndex, IOS_BACKGROUND_HOSTS)
    const simulator = process.env.DANWO_IOS_SIMULATOR

    return withIosDevice(backend, {
      worker: workerIndex,
      /* `danwo iPhone` (numbered from the second worker on) unless you name another. */
      ...(simulator !== undefined && { name: simulator }),
      app: { bundleId: build.bundleId ?? "dev.danwo.examples.swiftui", app: build.app },
    })
  },
})
