/**
 * A worker's environment with an Android device: the services (emulators, proxy) the config set
 * up, plus an emulator bound to that proxy. Tests then run on the device instead of a browser,
 * and get a `device` fixture for what only a device has (Back, what is in front).
 */
import type { WorkerEnvironment } from "@danwo/runner/runner"

import { type AndroidDevice, type AndroidDeviceOptions, androidDevice } from "./android/device.ts"

/** What tests on a device get besides the services' fixtures; type them with `test.extend<DeviceFixtures>()`. */
export interface DeviceFixtures {
  readonly device: AndroidDevice
}

/**
 * `env` with an Android device bound to its proxy, e.g. in a config's `environment()`:
 * `return withAndroidDevice({ ...services, baseUrl: shop.url, close }, { avd: "danwo_spike", app })`.
 * Closing it closes the device first (unbinding its network), then `env`.
 */
export async function withAndroidDevice(
  env: WorkerEnvironment,
  options: Omit<AndroidDeviceOptions, "proxy">,
): Promise<WorkerEnvironment & { readonly device: AndroidDevice }> {
  if (env.proxy === undefined) {
    throw new Error("withAndroidDevice needs an environment with a proxy, e.g. from startServices")
  }

  const device = await androidDevice({ ...options, proxy: env.proxy })

  /* Getters such as a `baseUrl` that follows a restarted app stay getters, not a copied value. */
  const withDevice: WorkerEnvironment = Object.defineProperties(
    { close: () => env.close() },
    Object.getOwnPropertyDescriptors(env),
  )

  return Object.assign(withDevice, {
    device,
    fixtures: { ...env.fixtures, device },
    async close() {
      await device.close()
      await env.close()
    },
  })
}
