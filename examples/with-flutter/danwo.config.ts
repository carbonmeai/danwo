import { fileURLToPath } from "node:url"

import {
  ANDROID_BACKGROUND_HOSTS,
  androidWorkers,
  buildAndroid,
  buildIos,
  IOS_BACKGROUND_HOSTS,
  iosWorkers,
  withAndroidDevice,
  withIosDevice,
} from "@danwo/mobile"
import { defineConfig, type WorkerEnvironment } from "@danwo/sdk"

import { waitlistBackend } from "./tests/stack/api.ts"

/** The Flutter app in `app/`: `danwo build-android app` and `danwo build-ios app` build it. */
const APP = fileURLToPath(new URL("./app", import.meta.url))
/** The emulator to boot: an AVD on a Google APIs image, which danwo can root to trust its CA. */
const AVD = process.env.DANWO_AVD ?? "danwo_spike"
/** `ios` runs the tests on an iOS Simulator; anything else, on an Android emulator. */
const IOS = process.env.DANWO_PLATFORM === "ios"

/** Builds the app for the simulator; then binds the worker's iOS Simulator to its backend. */
async function onIos(worker: number) {
  const build = await buildIos({ project: APP })
  const simulator = process.env.DANWO_IOS_SIMULATOR

  return (backend: WorkerEnvironment) =>
    withIosDevice(backend, {
      worker,
      /* `danwo iPhone` (numbered from the second worker on) unless you name another. */
      ...(simulator !== undefined && { name: simulator }),
      app: { bundleId: build.bundleId ?? "dev.danwo.examples.flutter", app: build.app },
    })
}

/** Builds the APK; then binds the worker's Android emulator to its backend. */
async function onAndroid(worker: number) {
  const build = await buildAndroid({ project: APP })

  return (backend: WorkerEnvironment) =>
    withAndroidDevice(backend, {
      avd: AVD,
      worker,
      /* A saved snapshot boots in seconds; without one the emulator boots cold. */
      ...(process.env.DANWO_AVD_SNAPSHOT !== undefined && {
        snapshot: process.env.DANWO_AVD_SNAPSHOT,
      }),
      app: { package: build.package ?? "dev.danwo.examples.flutter", apk: build.apk },
    })
}

export default defineConfig({
  testDir: "tests",
  /* Each worker boots its own device: as many as this machine has room for, at most three. */
  workers: IOS ? iosWorkers() : androidWorkers({ avd: AVD }),
  timeout: 120_000,
  /* The model agent steps run on. Its key is read from AI_GATEWAY_API_KEY; without one they skip. */
  model: "anthropic/claude-sonnet-5",
  /* Verified agent steps are kept here and replayed with no model call; git ignores the folder. */
  cache: { dir: ".danwo/cache" },
  /* After each tap, wait for the screen and for the calls it caused behind the app. */
  readiness: { mode: "page+backend", settle: true },
  /*
   * Each worker gets its own database, Resend emulator and API, and its own device bound to the
   * same proxy: the device's proxy setting and danwo's CA carry the app's HTTPS calls to the
   * worker's API. The app calls through the platform's own HTTP stack, which follows both; on
   * Android the build adds a network config that trusts danwo's CA. An unchanged app reuses its
   * kept build, and every test starts it afresh.
   */
  async environment({ workerIndex }) {
    /* The app is built before the backend starts, so a failed build leaves nothing running. */
    const bind = await (IOS ? onIos : onAndroid)(workerIndex)

    return bind(
      await waitlistBackend(workerIndex, IOS ? IOS_BACKGROUND_HOSTS : ANDROID_BACKGROUND_HOSTS),
    )
  },
})
