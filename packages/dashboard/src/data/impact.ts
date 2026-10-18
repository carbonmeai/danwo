/**
 * What each test touches behind the app, from the project's impact index: the app pages it opened,
 * the provider hosts and calls it made, and the webhooks those caused.
 */
import { readImpactIndex } from "@danwo/runner/runner"

export interface ImpactRow {
  readonly test: string
  readonly file: string
  readonly routes: readonly string[]
  readonly providers: readonly string[]
  readonly calls: readonly string[]
  readonly webhooks: readonly string[]
}

/** A call's host, e.g. `api.stripe.com` from `POST api.stripe.com/v1/charges`. */
function hostOf(call: string): string | undefined {
  return call.split(" ")[1]?.split("/")[0]
}

export async function getImpact(root: string): Promise<readonly ImpactRow[]> {
  const index = await readImpactIndex(root)

  return Object.entries(index.tests)
    .map(([test, entry]) => {
      const webhooks = entry.calls.filter((call) => call.startsWith("webhook "))
      const calls = entry.calls.filter((call) => !call.startsWith("webhook "))

      return {
        test,
        file: entry.file,
        routes: entry.routes,
        providers: [...new Set(calls.flatMap((call) => hostOf(call) ?? []))].toSorted(),
        calls,
        webhooks: webhooks.map((hook) => hook.slice("webhook ".length)),
      }
    })
    .toSorted((a, b) => a.test.localeCompare(b.test))
}
