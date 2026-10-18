/**
 * A Flutterwave v3 client for tests: plain `fetch` calls on Flutterwave's real URLs, answered by the
 * emulator in-process, plus a customer clicking through the hosted payment page.
 */
import { z } from "zod"

import { createEmulator, type Emulator } from "../src/define.ts"
import {
  flutterwave,
  type FlutterwaveSeedConfig,
  seedFlutterwave,
} from "../src/flutterwave/index.ts"
import { ManualClock } from "../src/time.ts"

export const SECRET_HASH = "flw-secret-hash"

const SECRET_KEY = "REDACTED-TEST-VALUE"

const Envelope = z.object({
  status: z.string(),
  message: z.string(),
  data: z.unknown(),
  meta: z.unknown().optional(),
})

export type Envelope = z.infer<typeof Envelope>

/** One API call; the answer is the envelope and its HTTP status. */
export async function call(
  emulator: Pick<Emulator, "fetch">,
  method: string,
  path: string,
  body?: unknown,
  key: string | null = SECRET_KEY,
): Promise<Envelope & { readonly http: number }> {
  const response = await emulator.fetch(
    new Request(`https://api.flutterwave.com${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(key !== null && { authorization: `Bearer ${key}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
  )

  return { ...Envelope.parse(await response.json()), http: response.status }
}

/** `data` of a call, parsed with `schema`. */
export function dataOf<T>(answer: Envelope, schema: z.ZodType<T>): T {
  return schema.parse(answer.data)
}

/** A hosted payment page as a customer sees it: its HTML after each step, and where it sent them. */
export class HostedPage {
  private readonly emulator: Pick<Emulator, "fetch">
  readonly link: URL
  /** Where the page redirected the customer last, when it left the page. */
  redirectedTo: URL | undefined

  constructor(emulator: Pick<Emulator, "fetch">, link: string) {
    this.emulator = emulator
    this.link = new URL(link)
  }

  /** The page's HTML now. */
  async html(): Promise<string> {
    return (await this.emulator.fetch(new Request(this.link))).text()
  }

  /** Submits the form of `step` with `fields`; returns the page afterwards, or undefined when it left. */
  async submit(step: string, fields: Record<string, string> = {}): Promise<string | undefined> {
    const response = await this.emulator.fetch(
      new Request(`${this.link.toString()}/${step}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
        redirect: "manual",
      }),
    )
    const location = response.headers.get("location") ?? ""

    if (response.status === 303) return this.html()

    this.redirectedTo = new URL(location, this.link)

    return undefined
  }
}

/** One webhook the emulator POSTed to the app. */
export interface Posted {
  readonly url: string
  readonly headers: Headers
  readonly body: string
}

/** A Flutterwave emulator on a manual clock, with its webhooks caught instead of sent. */
export interface TestFlutterwave {
  readonly emulator: Emulator
  readonly clock: ManualClock
  readonly posted: Posted[]
  /** Moves the clock on and waits for every webhook it set off. */
  pass(ms: number): Promise<void>
}

const WEBHOOK_URL = "http://app.test/flutterwave/webhook"

export function testFlutterwave(seed: FlutterwaveSeedConfig = {}): TestFlutterwave {
  const clock = new ManualClock(new Date("2026-10-18T08:00:00Z"))
  const posted: Posted[] = []
  const emulator = createEmulator(flutterwave, {
    clock: clock.clock,
    timer: clock.timer,
    fetch: async (url, init) => {
      const request = new Request(url, init)

      posted.push({ url: request.url, headers: request.headers, body: await request.text() })

      return new Response("ok")
    },
  })

  seedFlutterwave(emulator.store, {
    webhook: { url: WEBHOOK_URL, secretHash: SECRET_HASH },
    ...seed,
  })

  return {
    emulator,
    clock,
    posted,
    async pass(ms) {
      clock.advance(ms)
      await emulator.webhooks?.idle()
    },
  }
}

/** Pays a link with the PIN test card, through its PIN and OTP steps. */
export async function payWithPinCard(page: HostedPage, otp = "12345"): Promise<void> {
  await page.submit("card", { card_number: "5531886652142950", expiry: "09/32", cvv: "564" })
  await page.submit("pin", { pin: "3310" })
  await page.submit("otp", { otp })
}
