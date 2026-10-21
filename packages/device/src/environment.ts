/**
 * A worker's environment with a device: the services (emulators, proxy) the config set up, plus an
 * Android emulator or an iOS Simulator bound to that proxy. Tests then run on the device instead
 * of a browser, and get a `device` fixture for what only a device has (Back, what is in front).
 */
import type { WorkerEnvironment } from "@danwo/runner/runner"

import { type AndroidDevice, type AndroidDeviceOptions, androidDevice } from "./android/device.ts"
import { type IosDevice, type IosDeviceOptions, iosDevice } from "./ios/device.ts"

/** What tests on a device get besides the services' fixtures; type them with `test.extend<DeviceFixtures>()`. */
export interface DeviceFixtures {
  readonly device: AndroidDevice | IosDevice
}

/** The device behind a proxy-bound environment, closed before the environment. */
interface ClosableDevice {
  close(): Promise<void>
}

/** The proxy `env` must have for a device to be bound to it. */
function proxyOf(env: WorkerEnvironment, caller: string): NonNullable<WorkerEnvironment["proxy"]> {
  if (env.proxy === undefined) {
    throw new Error(`${caller} needs an environment with a proxy, e.g. from startServices`)
  }

  return env.proxy
}

/** `env` with `device` as its `device` fixture; closing it closes the device first, then `env`. */
function withDevice<D extends ClosableDevice>(
  env: WorkerEnvironment,
  device: D,
): WorkerEnvironment & { readonly device: D } {
  /* Getters such as a `baseUrl` that follows a restarted app stay getters, not a copied value. */
  const withIt: WorkerEnvironment = Object.defineProperties(
    { close: () => env.close() },
    Object.getOwnPropertyDescriptors(env),
  )

  return Object.assign(withIt, {
    device,
    fixtures: { ...env.fixtures, device },
    async close() {
      await device.close()
      await env.close()
    },
  })
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
  const proxy = proxyOf(env, "withAndroidDevice")

  return withDevice(env, await androidDevice({ ...options, proxy }))
}

/**
 * `env` with an iOS Simulator bound to its proxy, e.g. in a config's `environment()`:
 * `return withIosDevice({ ...services, baseUrl: shop.url, close }, { app: { bundleId, app } })`.
 * Closing it closes the simulator first (putting its proxy setting back), then `env`.
 */
export async function withIosDevice(
  env: WorkerEnvironment,
  options: Omit<IosDeviceOptions, "proxy">,
): Promise<WorkerEnvironment & { readonly device: IosDevice }> {
  const proxy = proxyOf(env, "withIosDevice")

  return withDevice(env, await iosDevice({ ...options, proxy }))
}
