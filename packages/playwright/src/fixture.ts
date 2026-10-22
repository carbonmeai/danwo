/**
 * The Playwright Test fixture: every worker starts the project's danwo environment once (app,
 * emulators, proxy) and launches its browser behind that proxy; every test gets `danwo` to reach
 * the emulators, read what the app sent, and arm faults; and a test's invariant runs after its
 * body, whichever way the body went.
 */
import { appendFile } from "node:fs/promises"
import { dirname, relative } from "node:path"
import { stripVTControlCharacters } from "node:util"

import type { ServiceDelivery } from "@danwo/matrix"
import type { Exchange, Proxy } from "@danwo/proxy"
import { proxyContextOptions, proxyLaunchOptions } from "@danwo/runner"
import { FaultBench, type NamedFault } from "@danwo/runner/runner"
import {
  test as base,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type TestInfo,
  type TestType,
} from "@playwright/test"

import { type EnvironmentFactory, startWorkerSetup, type WorkerSetup } from "./environment.ts"
import {
  OUTCOME_FILE,
  TRIAL_FAULT,
  type TestOutcome,
  deliveryLine,
  exchangeLine,
} from "./protocol.ts"
import {
  attachRecord,
  deliveriesSince,
  type EvidenceMark,
  exchangesSince,
  markOf,
  type Verdict,
} from "./record.ts"

/** What a test reaches danwo through. */
export interface DanwoHandle {
  /** The environment's fixtures by name: emulators (`stripe`, `slack`, …) and helpers. */
  readonly fixtures: Readonly<Record<string, unknown>>
  /** The proxy the browser and the app go through, when the environment has one. */
  readonly proxy: Proxy | undefined
  /** Lets pending background work finish, e.g. webhooks waiting on the emulator's clock. */
  settle(): Promise<void>
  /** Every call the app made through the proxy since this test began, bodies included. */
  exchanges(): readonly Exchange[]
  /** Every webhook delivery attempt since this test began. */
  deliveries(): readonly ServiceDelivery[]
  /**
   * Arms one fault by its matrix label, e.g. `duplicate on webhook checkout.session.completed` or
   * `status 500 on POST api.stripe.com/v1/checkout/sessions`; it fires on the next matching call.
   */
  inject(fault: string): NamedFault
  /** Disarms every fault this test armed; returns how many had not fired. */
  clearFaults(): number
}

/** The `danwo` fixture: the handle plus the environment's fixtures under their own names. */
export type Danwo<F = Readonly<Record<string, unknown>>> = DanwoHandle & F

export interface InvariantArgs<F> {
  readonly danwo: Danwo<F>
  readonly baseURL: string | undefined
}

/** What must hold after the test, however its body went: read from the app and the emulators. */
export type Invariant<F = Readonly<Record<string, unknown>>> = (
  args: InvariantArgs<F>,
) => Promise<void> | void

export interface DanwoTestFixtures<F> {
  danwo: Danwo<F>
  /** The test's invariant; set with `test.invariant(fn)` or `test.use({ invariant })`. */
  invariant: Invariant<F> | undefined
}

export interface DanwoWorkerFixtures {
  /** A danwo config file whose `environment()` the worker starts; default the nearest one. */
  danwoConfig: string | undefined
  /** An environment to start instead of the config's. */
  danwoEnvironment: EnvironmentFactory | undefined
  danwoWorker: WorkerSetup
}

export type DanwoTest<F = Readonly<Record<string, unknown>>> = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & DanwoTestFixtures<F>,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions & DanwoWorkerFixtures
> & {
  /** Declares the invariant of every test in this file or describe block. */
  invariant(fn: Invariant<F>): void
}

/** Where `danwoConfig` resolves from: the Playwright config's folder, else the working folder. */
function projectRoot(configFile: string | undefined): string {
  return configFile === undefined ? process.cwd() : dirname(configFile)
}

/** `text` without terminal colours, as Playwright's expect messages carry them. */
function plain(text: string): string {
  return stripVTControlCharacters(text)
}

function messageOf(error: unknown): string {
  return plain(error instanceof Error ? error.message : String(error))
}

function handleOf(setup: WorkerSetup, mark: EvidenceMark, bench: FaultBench): Danwo {
  const { env } = setup

  return {
    ...env.fixtures,
    fixtures: env.fixtures ?? {},
    proxy: env.proxy,
    settle: async () => {
      await env.settle?.()
      await env.proxy?.settled()
    },
    exchanges: () => exchangesSince(env, mark),
    deliveries: () => deliveriesSince(env, mark),
    inject: (fault) => bench.arm(fault),
    clearFaults: () => bench.clear(),
  }
}

async function runInvariant(
  invariant: Invariant | undefined,
  args: InvariantArgs<Readonly<Record<string, unknown>>>,
): Promise<string | null> {
  if (invariant === undefined) return null

  try {
    await invariant(args)

    return null
  } catch (error) {
    return messageOf(error)
  }
}

/** The spec file line the body's failure went through, read from the error's stack. */
function failureLine(testInfo: TestInfo): number | null {
  const stack = testInfo.error?.stack ?? ""
  const at = stack.split("\n").find((frame) => frame.includes(testInfo.file))
  const line = at === undefined ? undefined : /:(\d+):\d+\)?$/.exec(at)?.[1]

  return line === undefined ? null : Number(line)
}

/** Appends the test's outcome for `danwo-playwright matrix`, when it is the one running. */
async function reportOutcome(
  testInfo: TestInfo,
  setup: WorkerSetup,
  mark: EvidenceMark,
  result: { verdict: Verdict; declared: boolean; record: string | null },
): Promise<void> {
  const file = process.env[OUTCOME_FILE]

  if (file === undefined) return

  const outcome: TestOutcome = {
    title: testInfo.titlePath.join(" › "),
    file: relative(projectRoot(testInfo.config.configFile), testInfo.file).split("\\").join("/"),
    body: testInfo.status ?? "failed",
    bodyError: result.verdict.bodyError,
    invariant: result.declared ? { error: result.verdict.invariantError } : null,
    line: failureLine(testInfo),
    exchanges: exchangesSince(setup.env, mark).map(exchangeLine),
    deliveries: deliveriesSince(setup.env, mark).map(deliveryLine),
    record: result.record,
  }

  await appendFile(file, `${JSON.stringify(outcome)}\n`)
}

const fixtures = base.extend<
  DanwoTestFixtures<Readonly<Record<string, unknown>>>,
  DanwoWorkerFixtures
>({
  danwoConfig: [undefined, { option: true, scope: "worker" }],
  danwoEnvironment: [undefined, { option: true, scope: "worker" }],
  invariant: [undefined, { option: true }],
  danwoWorker: [
    async ({ danwoConfig, danwoEnvironment }, use, workerInfo) => {
      const setup = await startWorkerSetup({
        config: danwoConfig,
        environment: danwoEnvironment,
        cwd: projectRoot(workerInfo.config.configFile),
        workerIndex: workerInfo.parallelIndex,
      })

      try {
        await use(setup)
      } finally {
        await setup.env.close()
      }
    },
    { scope: "worker" },
  ],
  /*
   * The suite's own Playwright launches the browser, so its browser builds, its tracing and its
   * screenshots all match the `@playwright/test` the project installed; danwo only adds its proxy
   * and, for Chromium, the flag that trusts the proxy's CA.
   */
  browser: [
    async ({ danwoWorker, playwright, browserName, launchOptions }, use) => {
      const proxy = danwoWorker.env.proxy
      const behind = proxyLaunchOptions(
        proxy && { url: proxy.url, caSpki: proxy.caSpki },
        browserName,
      )
      const browser = await playwright[browserName].launch({
        ...launchOptions,
        headless: launchOptions.headless ?? true,
        ...(behind.proxy && { proxy: behind.proxy }),
        args: [...(launchOptions.args ?? []), ...(behind.args ?? [])],
      })

      try {
        await use(browser)
      } finally {
        await browser.close()
      }
    },
    { scope: "worker" },
  ],
  /*
   * Firefox and WebKit take no flag that trusts one CA, so their contexts behind danwo's proxy
   * ignore certificate errors: the proxy is then their only TLS peer, and it checks each real
   * site's certificate itself.
   */
  ignoreHTTPSErrors: async ({ ignoreHTTPSErrors, browserName, danwoWorker }, use) => {
    const proxy = danwoWorker.env.proxy
    const trust = proxyContextOptions(
      proxy && { url: proxy.url, caSpki: proxy.caSpki },
      browserName,
    )

    await use(trust.ignoreHTTPSErrors ?? ignoreHTTPSErrors)
  },
  baseURL: async ({ baseURL, danwoWorker }, use) => {
    await use(danwoWorker.env.baseUrl ?? baseURL)
  },
  danwo: [
    async ({ danwoWorker, invariant, baseURL }, use, testInfo) => {
      const mark = markOf(danwoWorker.env)
      const bench = new FaultBench(danwoWorker.env.proxy, danwoWorker.env.webhooks)
      const fault = process.env[TRIAL_FAULT] ?? null

      if (fault !== null) bench.arm(fault)

      const danwo = handleOf(danwoWorker, mark, bench)

      await use(danwo)
      await danwo.settle()

      const verdict: Verdict = {
        bodyError: testInfo.error?.message === undefined ? null : plain(testInfo.error.message),
        invariantError: await runInvariant(invariant, { danwo, baseURL }),
        fault,
      }
      const failed = verdict.bodyError !== null || verdict.invariantError !== null
      const record = failed ? await attachRecord(danwoWorker, mark, verdict, testInfo) : null

      await reportOutcome(testInfo, danwoWorker, mark, {
        verdict,
        declared: invariant !== undefined,
        record,
      })
      bench.clear()

      if (verdict.invariantError !== null) throw new Error(`invariant: ${verdict.invariantError}`)
    },
    { auto: true },
  ],
})

/**
 * Declares the invariant of every test in the current file or describe block. Playwright reads a
 * function given to `use` as a fixture, so the invariant is handed over by one.
 */
function declareInvariant(fn: Invariant): void {
  fixtures.use({
    invariant: async ({ danwoWorker: _worker }, use) => {
      await use(fn)
    },
  })
}

/** `test` from `@playwright/test`, with danwo's environment, `danwo` fixture and invariants. */
export const test: DanwoTest = Object.assign(fixtures, { invariant: declareInvariant })

/**
 * `test` with the environment's fixtures typed, e.g. `testWith<StripeFixtures>()` gives
 * `danwo.stripe`. The fixtures are whatever the environment returns; the type only names them.
 */
export function testWith<F>(): DanwoTest<F> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fixtures exist at run time; F only names the environment's fixtures for the caller
  return test as unknown as DanwoTest<F>
}

export { expect } from "@playwright/test"
