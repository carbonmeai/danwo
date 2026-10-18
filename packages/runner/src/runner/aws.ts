import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { Proxy } from "@danwo/proxy"

import { type Service, startServices } from "./services.ts"

const run = promisify(execFile)

/** The MiniStack image `docker: true` runs; MiniStack is MIT-licensed (ministack.org). */
export const MINISTACK_IMAGE = "ministackorg/ministack:1.5.28"

/** Options of `awsService()` and `awsEnvironment()`: where MiniStack runs and what it answers. */
export interface AwsOptions {
  /**
   * A MiniStack (or LocalStack) the user runs, e.g. `http://127.0.0.1:4566`. Ignored when `docker`
   * is set.
   */
  readonly endpoint?: string
  /**
   * Start a MiniStack container for this service and remove it on close. Each worker then has
   * its own, so resets never touch another worker's state. `true` uses `MINISTACK_IMAGE`.
   */
  readonly docker?: boolean | { readonly image?: string }
  /** Hosts sent to MiniStack. Default `*.amazonaws.com` (every AWS service and region). */
  readonly hosts?: readonly string[]
  /**
   * Wipe MiniStack's state between `danwo matrix` runs with `POST /_ministack/reset` (default
   * true). The reset is global: with a shared endpoint and several workers, turn it off or use
   * `docker`.
   */
  readonly reset?: boolean
}

/** What tests get as the `aws` fixture. */
export interface AwsFixture {
  /** The MiniStack endpoint, for setting up resources or reading state with an AWS SDK client. */
  readonly endpoint: string
}

/** What `awsEnvironment()` starts: AWS hosts sent to MiniStack through its own proxy. */
export interface AwsEnvironment {
  readonly endpoint: string
  readonly proxy: Proxy
  /** Moves the app's clock and the emulator's time forward by `ms`; see `time.travel`. */
  travel(ms: number): Promise<void>
  /** MiniStack wiped (unless `reset: false`), proxy log and fault rules cleared. */
  reset(): Promise<void>
  /** Fixtures for tests: `aws`, `proxy`, `settle`. */
  readonly fixtures: {
    readonly aws: AwsFixture
    readonly proxy: Proxy
    readonly settle: () => Promise<void>
  }
  close(): Promise<void>
}

async function waitForHealth(endpoint: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const healthy = await fetch(`${endpoint}/_ministack/health`).then(
      (res) => res.ok,
      () => false,
    )

    if (healthy) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`MiniStack at ${endpoint} did not become healthy in ${timeoutMs}ms`)
}

/** Runs a MiniStack container on a free host port; resolves once it answers its health check. */
async function startContainer(image: string): Promise<{ endpoint: string; stop(): Promise<void> }> {
  const { stdout } = await run("docker", ["run", "-d", "--rm", "-p", "127.0.0.1::4566", image])
  const id = stdout.trim()

  const stop = async () => {
    await run("docker", ["rm", "-f", id]).catch(() => undefined)
  }

  try {
    const { stdout: port } = await run("docker", ["port", id, "4566/tcp"])
    const endpoint = `http://${port.trim().split("\n")[0]}`

    await waitForHealth(endpoint)

    return { endpoint, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

async function resetMinistack(endpoint: string): Promise<void> {
  const res = await fetch(`${endpoint}/_ministack/reset`, { method: "POST" })

  if (!res.ok) throw new Error(`MiniStack reset failed: ${res.status}`)
}

/**
 * AWS through MiniStack for `startServices`: AWS hosts are forwarded to a MiniStack the user runs
 * (`endpoint`) or one started per worker (`docker`), with their original `Host`, so an unmodified
 * app keeps calling `sqs.us-east-1.amazonaws.com` or `<bucket>.s3.amazonaws.com`.
 */
export async function awsService(options: AwsOptions = {}): Promise<Service & AwsFixture> {
  const image = typeof options.docker === "object" ? options.docker.image : undefined
  const container = options.docker ? await startContainer(image ?? MINISTACK_IMAGE) : undefined
  const endpoint = (container?.endpoint ?? options.endpoint ?? "http://127.0.0.1:4566").replace(
    /\/$/,
    "",
  )

  if (!container) await waitForHealth(endpoint, 5_000)

  return {
    name: "aws",
    endpoint,
    routes: [{ hosts: options.hosts ?? ["*.amazonaws.com"], upstream: endpoint }],
    fixtures: { aws: { endpoint } satisfies AwsFixture },
    async reset() {
      if (options.reset !== false) await resetMinistack(endpoint)
    },
    async close() {
      await container?.stop()
    },
  }
}

/**
 * A worker-scoped MiniStack behind its own danwo proxy. To combine it with emulators behind one
 * proxy (e.g. Stripe and S3 emulators, MiniStack for SQS), use `awsService` with `startServices`.
 */
export async function awsEnvironment(
  options: AwsOptions & { readonly unmatched?: "passthrough" | "block" } = {},
): Promise<AwsEnvironment> {
  const service = await awsService(options)
  const services = await startServices([service], options).catch(async (error: unknown) => {
    await service.close()
    throw error
  })
  const { proxy } = services
  const settle = () => services.settle()

  return {
    endpoint: service.endpoint,
    proxy,
    travel: (ms: number) => services.travel(ms),
    reset: () => services.reset(),
    fixtures: { aws: { endpoint: service.endpoint }, proxy, settle },
    close: () => services.close(),
  }
}
