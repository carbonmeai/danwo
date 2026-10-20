import {
  createEmulator,
  type Emulator,
  s3,
  type S3SeedConfig,
  seedS3,
  TIGRIS_ENDPOINTS,
} from "@danwo/emulators"
import type { Proxy } from "@danwo/proxy"

import {
  keptEmulator,
  type Service,
  servicesLifecycle,
  settleFixture,
  startServices,
} from "./services.ts"

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
  /**
   * The environment an app on AWS S3 or Tigris reads to reach the emulator through the proxy:
   * `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_ENDPOINT_URL_S3` (and
   * `AWS_ENDPOINT_URL`), and the Tigris SDK's `TIGRIS_STORAGE_ACCESS_KEY_ID`,
   * `TIGRIS_STORAGE_SECRET_ACCESS_KEY`, `TIGRIS_STORAGE_ENDPOINT` and `TIGRIS_STORAGE_BUCKET`.
   * The key is the first seeded in `credentials`, or a stand-in the emulator accepts; the bucket
   * is the first seeded; the endpoint is Tigris's unless `endpoint` names another the service answers.
   */
  env(options?: { readonly endpoint?: string }): Record<string, string>
}

/** The key an app is handed when the seed names none: any well-formed key is accepted then. */
const STAND_IN_KEY = { accessKeyId: "tid_danwo_emulated", secretAccessKey: "tsec_danwo_emulated" }

/** The variables an S3 or Tigris app reads, pointed at `endpoint` with `seed`'s key and bucket. */
function s3Env(seed: S3SeedConfig | undefined, endpoint: string): Record<string, string> {
  const key = seed?.credentials?.[0] ?? STAND_IN_KEY
  const bucket = seed?.buckets?.[0]?.name

  return {
    AWS_ACCESS_KEY_ID: key.accessKeyId,
    AWS_SECRET_ACCESS_KEY: key.secretAccessKey,
    AWS_REGION: "auto",
    AWS_ENDPOINT_URL_S3: endpoint,
    AWS_ENDPOINT_URL: endpoint,
    TIGRIS_STORAGE_ACCESS_KEY_ID: key.accessKeyId,
    TIGRIS_STORAGE_SECRET_ACCESS_KEY: key.secretAccessKey,
    TIGRIS_STORAGE_ENDPOINT: endpoint,
    ...(bucket !== undefined && { TIGRIS_STORAGE_BUCKET: bucket }),
  }
}

/** What `s3Environment()` starts: the S3 emulator behind its own proxy. */
export interface S3Environment {
  readonly emulator: Emulator
  readonly proxy: Proxy
  /** The S3 and Tigris variables for the app; see `S3Service.env`. */
  env(options?: { readonly endpoint?: string }): Record<string, string>
  /** Moves the app's clock and the emulator's time forward by `ms`; see `time.travel`. */
  readonly travel: (ms: number) => Promise<void>
  /** Emulator back to its seed, proxy log and fault rules cleared. */
  reset(): Promise<void>
  /** Keeps the emulator's state now (right after a reset), for `restore`. */
  snapshot(slot?: string): Promise<void>
  /** Emulator back to the kept state, faster than a reset; proxy log and fault rules cleared. */
  restore(slot?: string): Promise<void>
  /** Whether `snapshot` and `restore` keep a state per slot. */
  readonly snapshotSlots: boolean
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
    env: (env = {}) => s3Env(options.seed, env.endpoint ?? `https://${TIGRIS_ENDPOINTS[0]}`),
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
    ...servicesLifecycle(services),
    emulator: service.emulator,
    proxy,
    env: (env) => service.env(env),
    fixtures: { s3: service.emulator, proxy, settle: settleFixture(settle) },
  }
}
