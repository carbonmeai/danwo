import {
  createEmulator,
  type Emulator,
  s3,
  type S3SeedConfig,
  seedS3,
  TIGRIS_ENDPOINTS,
} from "@danwo/emulators"
import type { Proxy } from "@danwo/proxy"

import { keptEmulator, type Service, startServices } from "./services.ts"

const DEFAULT_ENDPOINTS = [...TIGRIS_ENDPOINTS, "s3.amazonaws.com", "s3.us-east-1.amazonaws.com"]

/** Options of `s3Service()` and `s3Environment()`: buckets to seed and endpoints to answer. */
export interface S3Options {
  /** Buckets (and objects) to create on start and after every reset. */
  readonly seed?: S3SeedConfig
  /**
   * S3 endpoints the emulator answers, path-style and virtual-hosted (`<bucket>.<endpoint>`).
   * Default: Tigris (`t3.storage.dev`, `fly.storage.tigris.dev`), `s3.amazonaws.com` and
   * `s3.us-east-1.amazonaws.com`; add `s3.<region>.amazonaws.com` for other regions.
   */
  readonly endpoints?: readonly string[]
}

export interface S3Service extends Service {
  readonly emulator: Emulator
}

/** What `s3Environment()` starts: the S3 emulator behind its own proxy. */
export interface S3Environment {
  readonly emulator: Emulator
  readonly proxy: Proxy
  /** Moves the app's clock and the emulator's time forward by `ms`; see `time.travel`. */
  readonly travel: (ms: number) => Promise<void>
  /** Emulator back to its seed, proxy log and fault rules cleared. */
  reset(): Promise<void>
  /** Keeps the emulator's state now (right after a reset), for `restore`. */
  snapshot(): Promise<void>
  /** Emulator back to the kept state, faster than a reset; proxy log and fault rules cleared. */
  restore(): Promise<void>
  /** Fixtures for tests: `s3` (the emulator), `proxy`, `settle`. */
  readonly fixtures: {
    readonly s3: Emulator
    readonly proxy: Proxy
    readonly settle: () => Promise<void>
  }
  close(): Promise<void>
}

/** An S3 emulator for `startServices`, for apps on AWS S3 or Tigris; gives tests the `s3` fixture. */
export function s3Service(options: S3Options = {}): S3Service {
  const emulator = createEmulator(s3)
  const endpoints = options.endpoints ?? DEFAULT_ENDPOINTS

  const seed = () => {
    if (options.seed) seedS3(emulator.store, options.seed)
  }

  seed()

  return {
    name: "s3",
    emulator,
    routes: [
      {
        hosts: endpoints.flatMap((endpoint) => [endpoint, `*.${endpoint}`]),
        handler: emulator.fetch,
      },
    ],
    fixtures: { s3: emulator },
    state: () => emulator.snapshot(),
    async reset() {
      emulator.reset()
      seed()
    },
    ...keptEmulator(emulator),
    close: () => emulator.close(),
  }
}

/**
 * A worker-scoped S3 emulator behind its own danwo proxy. To combine it with other services
 * behind one proxy, use `s3Service` with `startServices`.
 */
export async function s3Environment(
  options: S3Options & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<S3Environment> {
  const service = s3Service(options)
  const services = await startServices([service], options)
  const { proxy } = services
  const settle = () => services.settle()

  return {
    emulator: service.emulator,
    proxy,
    travel: (ms: number) => services.travel(ms),
    reset: () => services.reset(),
    snapshot: () => services.snapshot(),
    restore: () => services.restore(),
    fixtures: { s3: service.emulator, proxy, settle },
    close: () => services.close(),
  }
}
