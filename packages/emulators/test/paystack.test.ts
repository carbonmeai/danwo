import { createHmac } from "node:crypto"

import Paystack from "paystack-sdk"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createEmulator, type Emulator } from "../src/define.ts"
import { asRecord } from "../src/json.ts"
import {
  paystack,
  PAYSTACK_TRANSFER_OTP,
  paystackBank,
  paystackLedger,
  paystackOutboundFaults,
  seedPaystack,
} from "../src/paystack/index.ts"
import { ManualClock } from "../src/time.ts"

const SECRET = "REDACTED-TEST-VALUE"
const OTHER_SECRET = "REDACTED-TEST-VALUE"
const WEBHOOK_URL = "http://shop.test/paystack/webhook"
const CALLBACK_URL = "http://shop.test/paystack/callback"

/** One event the emulator POSTed to the app. */
interface Posted {
  readonly event: string
  readonly body: string
  readonly signature: string
}

let clock: ManualClock
let emulator: Emulator
let posted: Posted[]
/** What the app answers to an event. */
let answer: number

beforeEach(() => {
  clock = new ManualClock(new Date("2026-10-18T08:00:00Z"))
  posted = []
  answer = 200
  emulator = createEmulator(paystack, {
    clock: clock.clock,
    timer: clock.timer,
    fetch: async (url, init) => {
      const request = new Request(url, init)
      const body = await request.text()

      posted.push({
        event: String(asRecord(JSON.parse(body))?.["event"]),
        body,
        signature: request.headers.get("x-paystack-signature") ?? "",
      })

      return new Response(null, { status: answer })
    },
  })
  seedPaystack(emulator.store, {
    integrations: [
      { secretKey: SECRET, webhookUrl: WEBHOOK_URL },
      { secretKey: OTHER_SECRET, transferOtp: true },
    ],
    accounts: [
      { bankCode: "058", accountNumber: "0123456789", accountName: "ADA LOVELACE" },
      {
        bankCode: "057",
        accountNumber: "0987654321",
        accountName: "GRACE HOPPER",
        transferOutcome: "failed",
      },
    ],
    plans: [{ planCode: "PLN_monthly", name: "Monthly", amount: 500_000, interval: "monthly" }],
  })
  // The SDK calls the global fetch; send its calls to the emulator.
  vi.stubGlobal("fetch", (url: string | URL | Request, init?: RequestInit) =>
    emulator.fetch(new Request(url, init)),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function pass(ms: number): Promise<void> {
  clock.advance(ms)
  await emulator.webhooks?.idle()
}

/** A request to the emulator, as the app or the customer's browser makes it. */
function call(method: string, url: string, body?: object, key = SECRET): Promise<Response> {
  return emulator.fetch(
    new Request(url, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      ...(body && { body: JSON.stringify(body) }),
    }),
  )
}

/** Submits a form on the hosted page, as the customer's browser does. */
function submit(url: string, fields: Record<string, string>): Promise<Response> {
  return emulator.fetch(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      redirect: "manual",
    }),
  )
}

/** Initializes a ₦5,000 transaction with the SDK and returns its page URL and reference. */
async function initialize(extra: object = {}) {
  const sdk = new Paystack(SECRET)
  const started = await sdk.transaction.initialize({
    email: "ada@shop.test",
    amount: "500000",
    callback_url: CALLBACK_URL,
    ...extra,
  })

  if (!("data" in started) || started.data === null) throw new Error(started.message)

  return started.data
}

/** The `data` object of a Paystack answer. */
async function dataOf(response: Response): Promise<Record<string, unknown>> {
  return asRecord(asRecord(await response.json())?.["data"]) ?? {}
}

/** A field of an answer's data, as text. */
function field(data: Record<string, unknown>, name: string): string {
  const value = data[name]

  return typeof value === "string" ? value : ""
}

const CARD = { number: "4084 0840 8408 4081", expiry: "12/30", cvv: "408" }

describe("Paystack transactions", () => {
  it("initializes, is paid on the hosted page with a test card, verifies, and sends a signed charge.success", async () => {
    const { authorization_url, reference } = await initialize()
    const verify = () => call("GET", `https://api.paystack.co/transaction/verify/${reference}`)

    expect(authorization_url).toMatch(/^https:\/\/checkout\.paystack\.com\/[a-z0-9]{15}$/)
    expect(await dataOf(await verify())).toMatchObject({ status: "abandoned" })

    const page = await emulator.fetch(new Request(authorization_url))

    expect(await page.text()).toContain("Pay ₦5,000.00")

    const paid = await submit(`${authorization_url}/card`, CARD)

    expect(paid.status).toBe(303)
    expect(paid.headers.get("location")).toBe(
      `${CALLBACK_URL}?trxref=${reference}&reference=${reference}`,
    )

    expect(await dataOf(await verify())).toMatchObject({
      status: "success",
      authorization: { last4: "4081", reusable: true },
    })

    await pass(0)
    expect(posted.map((p) => [p.event, p.signature])).toEqual([
      [
        "charge.success",
        createHmac("sha512", SECRET)
          .update(posted[0]?.body ?? "")
          .digest("hex"),
      ],
    ])
  })

  it("walks a card that asks for a PIN and then an OTP, refusing a wrong PIN", async () => {
    const { authorization_url, reference } = await initialize()
    const card = { number: "5078 5078 5078 5078 12", expiry: "12/30", cvv: "081" }

    expect(await (await submit(`${authorization_url}/card`, card)).text()).toContain("Card PIN")
    expect(await (await submit(`${authorization_url}/pin`, { pin: "0000" })).text()).toContain(
      "Incorrect PIN",
    )
    expect(await (await submit(`${authorization_url}/pin`, { pin: "1111" })).text()).toContain(
      "Enter the OTP",
    )
    expect((await submit(`${authorization_url}/otp`, { otp: "123456" })).status).toBe(303)
    expect(paystackLedger(emulator).transaction(reference)?.status).toBe("success")
  })

  it("declines a declined card without an event, and pays by bank transfer or USSD", async () => {
    const declined = await initialize()
    const refused = await submit(`${declined.authorization_url}/card`, {
      ...CARD,
      number: "4084080000005408",
      cvv: "001",
    })

    expect(refused.status).toBe(402)
    expect(paystackLedger(emulator).transaction(declined.reference)?.status).toBe("failed")

    const transfer = await initialize()
    const ussd = await initialize()

    await submit(`${transfer.authorization_url}/transfer`, {})
    await submit(`${ussd.authorization_url}/ussd`, {})
    await pass(0)

    expect(paystackLedger(emulator).transaction(transfer.reference)?.channel).toBe("bank_transfer")
    expect(paystackLedger(emulator).transaction(ussd.reference)?.channel).toBe("ussd")
    expect(posted.map((p) => p.event)).toEqual(["charge.success", "charge.success"])
  })

  it("refuses a duplicate reference, an unknown key and a bad email in Paystack's words", async () => {
    await initialize({ reference: "order-1" })

    const again = await call("POST", "https://api.paystack.co/transaction/initialize", {
      email: "ada@shop.test",
      amount: 500_000,
      reference: "order-1",
    })
    const unknown = await call(
      "GET",
      "https://api.paystack.co/transaction",
      undefined,
      "sk_test_nope",
    )
    const noEmail = await call("POST", "https://api.paystack.co/transaction/initialize", {
      amount: 100,
    })

    expect([again.status, await again.json()]).toEqual([
      400,
      { status: false, message: "Duplicate Transaction Reference" },
    ])
    expect([unknown.status, await unknown.json()]).toEqual([
      401,
      { status: false, message: "Invalid key" },
    ])
    expect(noEmail.status).toBe(400)
  })

  it("charges a saved authorization, lists with paging, totals and fetches by id", async () => {
    const { authorization_url, reference } = await initialize()

    await submit(`${authorization_url}/card`, CARD)

    const sdk = new Paystack(SECRET)
    const first = paystackLedger(emulator).transaction(reference)
    const code =
      first?.authorization && "authorization_code" in first.authorization
        ? first.authorization.authorization_code
        : ""
    const charged = await sdk.transaction.chargeAuthorization({
      email: "ada@shop.test",
      amount: "200000",
      authorization_code: code,
    })
    const listed = await call("GET", "https://api.paystack.co/transaction?perPage=1&page=2")
    const totals = await call("GET", "https://api.paystack.co/transaction/totals")
    const fetched = await call("GET", `https://api.paystack.co/transaction/${first?.id ?? 0}`)

    expect("data" in charged && charged.data?.status).toBe("success")
    expect(await listed.json()).toMatchObject({
      data: [{ reference }],
      meta: { total: 2, perPage: 1, page: 2, pageCount: 2 },
    })
    expect(await totals.json()).toMatchObject({
      data: { total_transactions: 2, total_volume: 700_000 },
    })
    expect(await fetched.json()).toMatchObject({ data: { reference } })
  })
})

describe("Paystack customers, plans and subscriptions", () => {
  it("creates, fetches and updates customers", async () => {
    const created = await call("POST", "https://api.paystack.co/customer", {
      email: "Grace@Shop.test",
      first_name: "Grace",
    })
    const data = await dataOf(created)
    const updated = await call(
      "PUT",
      `https://api.paystack.co/customer/${field(data, "customer_code")}`,
      {
        last_name: "Hopper",
      },
    )
    const byEmail = await call("GET", "https://api.paystack.co/customer/grace@shop.test")

    expect(await updated.json()).toMatchObject({
      data: { first_name: "Grace", last_name: "Hopper" },
    })
    expect(await byEmail.json()).toMatchObject({ data: { email: "grace@shop.test" } })
  })

  it("subscribes on paying for a plan, renews on the clock and can be disabled", async () => {
    const { authorization_url } = await initialize({ plan: "PLN_monthly" })

    await submit(`${authorization_url}/card`, CARD)
    await pass(0)

    const [subscription] = paystackLedger(emulator).subscriptions()

    expect(subscription?.status).toBe("active")
    expect(posted.map((p) => p.event)).toEqual(["charge.success", "subscription.create"])

    await pass(30 * 24 * 3_600_000)

    expect(posted.map((p) => p.event).slice(2)).toEqual([
      "invoice.create",
      "charge.success",
      "invoice.update",
    ])

    const disabled = await call("POST", "https://api.paystack.co/subscription/disable", {
      code: subscription?.subscription_code,
      token: subscription?.email_token,
    })

    expect(await disabled.json()).toEqual({
      status: true,
      message: "Subscription disabled successfully",
    })
    await pass(30 * 24 * 3_600_000)
    expect(posted.map((p) => p.event).at(-1)).toBe("subscription.disable")
  })
})

/** A transfer recipient for a bank account, made through the API. */
async function recipient(accountNumber: string, bankCode: string, key = SECRET): Promise<string> {
  const answered = await call(
    "POST",
    "https://api.paystack.co/transferrecipient",
    { type: "nuban", name: "Payee", account_number: accountNumber, bank_code: bankCode },
    key,
  )
  const data = await dataOf(answered)

  return field(data, "recipient_code")
}

describe("Paystack transfers, refunds and dedicated accounts", () => {
  it("resolves account names, and settles transfers to success or failure on the clock", async () => {
    const resolved = await call(
      "GET",
      "https://api.paystack.co/bank/resolve?account_number=0123456789&bank_code=058",
    )

    expect(await resolved.json()).toMatchObject({ data: { account_name: "ADA LOVELACE" } })

    for (const [number, bank] of [
      ["0123456789", "058"],
      ["0987654321", "057"],
    ] as const)
      await call("POST", "https://api.paystack.co/transfer", {
        source: "balance",
        amount: 100_000,
        recipient: await recipient(number, bank),
      })

    await pass(1000)

    expect(
      paystackLedger(emulator)
        .transfers()
        .map((t) => t.status),
    ).toEqual(["success", "failed"])
    expect(posted.map((p) => p.event)).toEqual(["transfer.success", "transfer.failed"])
  })

  it("asks for an OTP when the integration has transfer OTPs on", async () => {
    const started = await call(
      "POST",
      "https://api.paystack.co/transfer",
      {
        source: "balance",
        amount: 100,
        recipient: await recipient("0123456789", "058", OTHER_SECRET),
      },
      OTHER_SECRET,
    )
    const data = await dataOf(started)
    const finalized = await call(
      "POST",
      "https://api.paystack.co/transfer/finalize_transfer",
      { transfer_code: field(data, "transfer_code"), otp: PAYSTACK_TRANSFER_OTP },
      OTHER_SECRET,
    )

    expect(field(data, "status")).toBe("otp")
    expect(await finalized.json()).toMatchObject({ data: { status: "pending" } })
  })

  it("refunds a paid transaction, reversing it once processed", async () => {
    const { authorization_url, reference } = await initialize()

    await submit(`${authorization_url}/card`, CARD)

    const refunded = await call("POST", "https://api.paystack.co/refund", {
      transaction: reference,
    })
    const tooMuch = await call("POST", "https://api.paystack.co/refund", {
      transaction: reference,
      amount: 1,
    })

    expect(await refunded.json()).toMatchObject({ data: { status: "pending", amount: 500_000 } })
    expect(tooMuch.status).toBe(400)
    await pass(2000)
    expect(paystackLedger(emulator).transaction(reference)?.status).toBe("reversed")
    expect(posted.map((p) => p.event)).toEqual(["charge.success", "refund.processed"])
  })

  it("opens a dedicated account and turns money sent to it into a paid transaction", async () => {
    await call("POST", "https://api.paystack.co/customer", { email: "ada@shop.test" })

    const opened = await call("POST", "https://api.paystack.co/dedicated_account", {
      customer: "ada@shop.test",
    })
    const data = await dataOf(opened)
    const paid = paystackBank(emulator).transferTo(field(data, "account_number"), 250_000)

    await pass(0)

    expect(paid).toMatchObject({ status: "success", channel: "dedicated_nuban", amount: 250_000 })
    expect(posted.map((p) => p.event)).toEqual(["charge.success"])
  })
})

/** Each fault's kind, with the status for status faults. */
function kinds(faults: readonly { kind: string; status?: number }[]): string[] {
  return faults.map((f) => (f.kind === "status" ? `status ${f.status ?? 0}` : f.kind))
}

describe("Paystack faults and retries", () => {
  it("retries an event the app did not answer with 200", async () => {
    answer = 500

    const { authorization_url } = await initialize()

    await submit(`${authorization_url}/card`, CARD)
    await pass(0)
    answer = 200
    await pass(3 * 60_000)

    expect(posted.map((p) => p.event)).toEqual(["charge.success", "charge.success"])
  })

  it("faults writes harder than reads, can leave a verify pending, and leaves the hosted page alone", () => {
    expect(
      kinds(paystackOutboundFaults({ method: "POST", path: "/transaction/initialize" })),
    ).toEqual(["status 429", "status 500", "status 503", "delay", "reset", "reset-after"])
    expect(
      kinds(paystackOutboundFaults({ method: "GET", path: "/transaction/verify/abc" })),
    ).toEqual(["status 429", "status 500", "reset", "status 200"])
    expect(
      paystackOutboundFaults({ method: "POST", path: "/x/card", host: "checkout.paystack.com" }),
    ).toEqual([])
  })
})
