/**
 * The fixture's view of everything a test can change: Stripe customers, Resend emails, Composio
 * auth configs, the apps' clock offset and, with a database, the orders table.
 */
import { appendFileSync } from "node:fs"
import { join } from "node:path"

import { type Emulator, test as base } from "@danwo/sdk"

/** The environment's fixtures these tests use. */
interface Fixtures {
  readonly stripe: Emulator
  readonly resend: Emulator
  readonly composio: Emulator
  readonly proxy: { readonly clock: { offset(): number } }
  readonly orders: () => Promise<number>
  readonly order: () => Promise<unknown>
  readonly database: boolean
}

export const test = base.extend<Fixtures>()

/** How many items the JSON list endpoint `url` on `emulator` answers with under `field`. */
async function countAt(
  emulator: Emulator,
  url: string,
  headers: Readonly<Record<string, string>>,
  field: "data" | "items",
): Promise<number> {
  const answer: unknown = await (await emulator.fetch(new Request(url, { headers }))).json()
  const list: unknown = Object(answer)[field]

  return Array.isArray(list) ? list.length : 0
}

/** What the state is now: one number per thing a test can change. */
async function stateOf(fixtures: Fixtures) {
  return {
    customers: await countAt(
      fixtures.stripe,
      "https://api.stripe.com/v1/customers",
      { authorization: "Bearer sk_test_x" },
      "data",
    ),
    emails: await countAt(
      fixtures.resend,
      "https://api.resend.com/emails",
      { authorization: "Bearer re_test" },
      "data",
    ),
    authConfigs: await countAt(
      fixtures.composio,
      "https://backend.composio.dev/api/v3/auth_configs",
      { "x-api-key": "ak_isolation" },
      "items",
    ),
    clockOffset: fixtures.proxy.clock.offset(),
    orders: fixtures.database ? await fixtures.orders() : 0,
  }
}

/** Writes what `test` found when it started, for the run's checks to read. */
export async function observe(title: string, fixtures: Fixtures): Promise<void> {
  const line = JSON.stringify({ test: title, ...(await stateOf(fixtures)) })

  appendFileSync(join(process.env.DANWO_FIXTURE_STATE ?? ".", "observed.jsonl"), `${line}\n`)
}

/** Changes every kind of state once, through the providers' APIs and the database. */
export async function changeEverything(
  fixtures: Fixtures & { readonly time: { travel(by: { days: number }): Promise<void> } },
): Promise<void> {
  await fixtures.stripe.fetch(
    new Request("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: {
        authorization: "Bearer sk_test_x",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "email=ada@shop.test",
    }),
  )
  await fixtures.resend.fetch(
    new Request("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer re_test", "content-type": "application/json" },
      body: JSON.stringify({
        from: "qa@danwo.test",
        to: "ada@shop.test",
        subject: "Hi",
        html: "Hi",
      }),
    }),
  )
  await fixtures.composio.fetch(
    new Request("https://backend.composio.dev/api/v3/auth_configs", {
      method: "POST",
      headers: { "x-api-key": "ak_isolation", "content-type": "application/json" },
      body: JSON.stringify({ toolkit: { slug: "slack" } }),
    }),
  )
  await fixtures.time.travel({ days: 30 })
  if (fixtures.database) await fixtures.order()
}
