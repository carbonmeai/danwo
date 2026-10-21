import type { WebhookDispatcher } from "@danwo/emulators"
/**
 * The backend side of readiness, from a worker's environment: the app's calls through the proxy
 * have all finished, and no webhook delivery is in flight. A delivery the app's call caused may
 * only be queued when that call returns, so quiet is checked again after a short pause until a
 * round sees nothing new; a backend that has done nothing for that long already gets no pause. With
 * `settle`, the environment's own settling (webhooks on a manual clock, retries) runs as part of it.
 */
import { type RunWebhooks, routeOf, webhookSources } from "@danwo/matrix"
import { isPageAsset, type Proxy } from "@danwo/proxy"

import type { Backend, BackendActivity, BackendEvent } from "../browser/readiness.ts"
import type { WorkerEnvironment } from "./environment.ts"

/** The pause between rounds, for deliveries a finished call has only just queued. */
const ROUND_PAUSE_MS = 25
/** Rounds at most; a backend still busy after this many is left to the next action. */
const MAX_ROUNDS = 4

function dispatchers(webhooks: RunWebhooks | undefined): readonly WebhookDispatcher[] {
  return webhookSources(webhooks).map(([, dispatcher]) => dispatcher)
}

/** What has happened at the proxy and the senders so far: a round that adds nothing is quiet. */
function activity(env: WorkerEnvironment): number {
  const calls = env.proxy?.exchanges().length ?? 0
  const deliveries = dispatchers(env.webhooks).reduce((n, d) => n + d.attempts().length, 0)

  return calls + deliveries
}

/**
 * What has happened so far, counting finishes too: calls started and finished at the proxy, and
 * deliveries made. It stays the same only while the backend does nothing at all.
 */
function pulseOf(env: WorkerEnvironment): number {
  const finished = (env.proxy?.exchanges() ?? []).filter(
    (call) => call.status !== null || call.aborted,
  ).length

  return activity(env) + finished
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** One round: open calls finished, deliveries in flight finished, and settling when asked. */
async function round(env: WorkerEnvironment, timeoutMs: number, settle: boolean): Promise<void> {
  await env.proxy?.settled(timeoutMs)
  await Promise.all(dispatchers(env.webhooks).map((dispatcher) => dispatcher.idle()))
  if (settle) await env.settle?.()
}

/**
 * The calls the app made through the proxy. A call the proxy blocked never reached anyone: it is
 * the device's or browser's own background traffic (update checks, sync), not something the app
 * caused, and when it fires differs from run to run. The page loading itself (static files, a dev
 * server's modules and hot reload) is left out the same way: it is not a call the app makes.
 */
function providerCalls(proxy: Proxy): BackendEvent[] {
  return proxy
    .exchanges()
    .filter((call) => call.disposition !== "blocked" && !(call.asset ?? isPageAsset(call.path)))
    .map((call) => ({ signature: routeOf(call), fault: call.fault }))
}

/** First attempts only: a retry is the same delivery again, not something new the app caused. */
function firstDeliveries(webhooks: RunWebhooks | undefined): BackendEvent[] {
  return dispatchers(webhooks).flatMap((dispatcher) =>
    dispatcher
      .attempts()
      .filter((attempt) => attempt.attempt === 1)
      .map((attempt) => ({ signature: `webhook ${attempt.topic}`, fault: attempt.fault })),
  )
}

/** Provider calls and webhook deliveries so far, each in the order it happened. */
function activityOf(proxy: Proxy, webhooks: RunWebhooks | undefined): BackendActivity {
  return { calls: providerCalls(proxy), deliveries: firstDeliveries(webhooks) }
}

/** The environment's backend, or undefined when it has no proxy to watch. */
export function backendOf(
  env: WorkerEnvironment | undefined,
  options: { readonly settle?: boolean } = {},
): Backend | undefined {
  if (env?.proxy === undefined) return undefined

  const proxy = env.proxy

  /**
   * The pulse last seen, and since when: the proxy's first call tells a log cleared by a reset from
   * the same one, should the count come back to the same number.
   */
  let seen = { pulse: -1, first: proxy.exchanges()[0], at: 0 }

  const pulse = () => {
    const now = pulseOf(env)
    const first = proxy.exchanges()[0]

    if (now !== seen.pulse || first !== seen.first)
      seen = { pulse: now, first, at: performance.now() }

    return now
  }

  return {
    pulse,
    activity: () => activityOf(proxy, env.webhooks),
    failures: () =>
      proxy
        .exchanges()
        .filter((call) => call.aborted || (call.status !== null && call.status >= 500))
        .map(
          (call) =>
            `${call.method} ${call.host}${call.path.split("?")[0] ?? ""} → ${call.aborted ? "no answer" : String(call.status)}`,
        ),
    async quiet(timeoutMs) {
      const deadline = performance.now() + timeoutMs

      for (let n = 0; n < MAX_ROUNDS && performance.now() < deadline; n++) {
        const before = activity(env)
        const mark = pulse()

        await round(env, Math.max(1, deadline - performance.now()), options.settle ?? false)
        /* Nothing started or finished for a pause's length already: no delivery is about to show. */
        if (pulse() === mark && performance.now() - seen.at >= ROUND_PAUSE_MS) return
        await pause(ROUND_PAUSE_MS)
        if (activity(env) === before) return
      }
    },
  }
}
