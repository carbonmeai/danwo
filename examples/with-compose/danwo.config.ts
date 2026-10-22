import { fileURLToPath } from "node:url"

import {
  ANDROID_BACKGROUND_HOSTS,
  androidWorkers,
  buildAndroid,
  withAndroidDevice,
} from "@danwo/mobile"
import { defineConfig } from "@danwo/sdk"

import { waitlistBackend } from "./tests/stack/api.ts"

/** The Gradle project in `android/`: `danwo build-android android` builds it and keeps the APK. */
const APP = fileURLToPath(new URL("./android", import.meta.url))
/** The emulator to boot: an AVD on a Google APIs image, which danwo can root to trust its CA. */
const AVD = process.env.DANWO_AVD ?? "danwo_spike"

export default defineConfig({
  testDir: "tests",
  /* Each worker boots its own emulator: as many as this machine has room for, at most three. */
  workers: androidWorkers({ avd: AVD }),
  timeout: 120_000,
  /* The model agent steps run on. Its key is read from AI_GATEWAY_API_KEY; without one they skip. */
  model: "anthropic/claude-sonnet-5",
  /* Verified agent steps are kept here and replayed with no model call; git ignores the folder. */
  cache: { dir: ".danwo/cache" },
  /* After each tap, wait for the screen and for the calls it caused behind the app. */
  readiness: { mode: "page+backend", settle: true },
  /*
   * Each worker gets its own database, Resend emulator and API, and its own emulator bound to the
   * same proxy: the emulator's proxy setting and danwo's CA carry the app's HTTPS calls to the
   * worker's API. The build adds a network config that trusts danwo's CA; the app's code is not
   * changed. Every test starts the app afresh.
   */
  async environment({ workerIndex }) {
    /* An unchanged app reuses its kept build. */
    const build = await buildAndroid({ project: APP })
    const backend = await waitlistBackend(workerIndex, ANDROID_BACKGROUND_HOSTS)

    return withAndroidDevice(backend, {
      avd: AVD,
      worker: workerIndex,
      /* A saved snapshot boots in seconds; without one the emulator boots cold. */
      ...(process.env.DANWO_AVD_SNAPSHOT !== undefined && {
        snapshot: process.env.DANWO_AVD_SNAPSHOT,
      }),
      app: { package: build.package ?? "dev.danwo.examples.compose", apk: build.apk },
    })
  },
})
