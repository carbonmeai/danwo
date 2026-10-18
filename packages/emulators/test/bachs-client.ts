import { once } from "node:events"
import type { Server } from "node:http"

import { Bachs, type WebhookEvent, webhooks } from "@bachs/sdk"

import { type BachsSeedConfig, bachs, seedBachs } from "../src/bachs/index.ts"
import { createEmulator, type Emulator } from "../src/define.ts"
import { serve } from "../src/http.ts"
import { listeningPort } from "../src/net.ts"
import { ManualClock } from "../src/time.ts"

const API_KEY = "sk_sandbox_danwo_test"
const WEBHOOK_SECRET = "whsec_danwo_test_secret"
const WEBHOOK_URL = "http://app.test/webhooks/bachs"

/** One webhook the emulator POSTed to the app, with the event the SDK verified out of it. */
export interface Delivered {
  readonly headers: Record<string, string>
  readonly body: string
  readonly event: WebhookEvent
}

/** A Bachs emulator served over HTTP, the official SDK pointed at it, and the webhooks it sent. */
export interface BachsHarness {
  readonly emulator: Emulator
  readonly client: Bachs
  readonly clock: ManualClock
  readonly delivered: Delivered[]
  /** Moves the emulator's clock on and waits for every webhook that set off. */
  pass(ms: number): Promise<void>
  /** The types of the events delivered so far, in order. */
  types(): string[]
  /** Pays a checkout on its hosted page with the given form fields. */
  pay(checkoutUrl: string, fields?: Record<string, string>): Promise<Response>
  /** Calls the API in-process with the test key. */
  call(method: string, path: string, body?: unknown): Promise<Response>
  close(): Promise<void>
}

/** A year: wide enough that a delivery made on the emulator's clock still verifies. */
const TOLERANCE_SECONDS = 365 * 24 * 60 * 60

export async function startBachs(seed: BachsSeedConfig = {}): Promise<BachsHarness> {
  const clock = new ManualClock(new Date())
  const delivered: Delivered[] = []
  const emulator = createEmulator(bachs, {
    clock: clock.clock,
    timer: clock.timer,
    fetch: async (url, init) => {
      const request = new Request(url, init)
      const headers = Object.fromEntries(request.headers)
      const body = await request.text()
      const event = webhooks.constructEvent(body, headers, WEBHOOK_SECRET, {
        toleranceSeconds: TOLERANCE_SECONDS,
      })

      delivered.push({ headers, body, event })

      return new Response(null, { status: 200 })
    },
  })

  seedBachs(emulator.store, {
    webhookEndpoints: [{ url: WEBHOOK_URL, events: ["*"], secret: WEBHOOK_SECRET }],
    ...seed,
  })

  const server: Server = serve({ fetch: (request) => emulator.fetch(request), port: 0 })

  await once(server, "listening")

  const client = new Bachs({
    apiKey: API_KEY,
    environment: "sandbox",
    baseURL: `http://127.0.0.1:${listeningPort(server)}`,
  })

  return {
    emulator,
    client,
    clock,
    delivered,
    async pass(ms) {
      clock.advance(ms)
      await emulator.webhooks?.idle()
    },
    types: () => delivered.map((item) => item.event.type),
    async pay(checkoutUrl, fields = {}) {
      const token = new URL(checkoutUrl).pathname.split("/").at(-1) ?? ""
      const response = await emulator.fetch(
        new Request(`https://checkout.bachs.io/c/${token}/pay`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ card: "4242 4242 4242 4242", ...fields }),
        }),
      )

      clock.advance(0)
      await emulator.webhooks?.idle()

      return response
    },
    call: (method, path, body) =>
      emulator.fetch(
        new Request(`https://sandbox-api.bachs.io${path}`, {
          method,
          headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        }),
      ),
    async close() {
      server.close()
      await emulator.close()
    },
  }
}
