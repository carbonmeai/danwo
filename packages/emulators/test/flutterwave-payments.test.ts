import { createHmac } from "node:crypto"

import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { flutterwaveLedger, flutterwaveOutboundFaults } from "../src/flutterwave/index.ts"
import { fakeKey } from "./fake-key.ts"
import {
  call,
  dataOf,
  HostedPage,
  payWithPinCard,
  SECRET_HASH,
  type TestFlutterwave,
  testFlutterwave,
} from "./flutterwave-client.ts"

const Link = z.object({ link: z.string() })
const Transaction = z.object({
  id: z.number(),
  tx_ref: z.string(),
  amount: z.number(),
  currency: z.string(),
  status: z.string(),
  payment_type: z.string(),
  processor_response: z.string(),
  auth_model: z.string(),
  app_fee: z.number(),
  amount_settled: z.number(),
  customer: z.object({ email: z.string() }),
  card: z.object({ last_4digits: z.string(), token: z.string() }).optional(),
})
const Webhook = z.object({
  event: z.string(),
  data: z.object({ id: z.number(), tx_ref: z.string(), status: z.string() }),
})

let fw: TestFlutterwave

beforeEach(() => {
  fw = testFlutterwave()
})

/** A Standard payment link for `amount` NGN, with optional extra fields. */
async function newLink(txRef: string, extra: Record<string, unknown> = {}): Promise<HostedPage> {
  const answer = await call(fw.emulator, "POST", "/v3/payments", {
    tx_ref: txRef,
    amount: "7500",
    currency: "NGN",
    redirect_url: "http://app.test/paid",
    customer: { email: "ada@example.com", name: "Ada Lovelace", phonenumber: "08012345678" },
    customizations: { title: "Credits" },
    ...extra,
  })

  expect(answer).toMatchObject({ status: "success", message: "Hosted Link" })

  return new HostedPage(fw.emulator, dataOf(answer, Link).link)
}

/** The `charge.completed` webhooks delivered so far, parsed. */
function chargeWebhooks() {
  return fw.posted.map((post) => Webhook.parse(JSON.parse(post.body)))
}

describe("authorization", () => {
  it("asks for a key, and refuses keys that are not test secret keys", async () => {
    const missing = await call(fw.emulator, "GET", "/v3/transactions", undefined, null)
    const live = await call(
      fw.emulator,
      "GET",
      "/v3/transactions",
      undefined,
      fakeKey("FLW", "SECK-live-X"),
    )

    expect(missing).toMatchObject({ http: 401, status: "error", message: "Authorization required" })
    expect(live).toMatchObject({ http: 401, message: "Invalid authorization key" })
  })
})

describe("Flutterwave Standard", () => {
  it("pays a link with the PIN card and redirects with status, tx_ref and transaction_id", async () => {
    const page = await newLink("order-1")

    expect(page).toBeInstanceOf(HostedPage)
    expect(await page.html()).toContain("NGN 7,500.00")

    await payWithPinCard(page)

    const query = page.redirectedTo?.searchParams

    expect(page.redirectedTo?.origin + (page.redirectedTo?.pathname ?? "")).toBe(
      "http://app.test/paid",
    )
    expect(query?.get("status")).toBe("successful")
    expect(query?.get("tx_ref")).toBe("order-1")

    const verified = await call(
      fw.emulator,
      "GET",
      `/v3/transactions/${query?.get("transaction_id")}/verify`,
    )

    expect(verified.message).toBe("Transaction fetched successfully")
    expect(dataOf(verified, Transaction)).toMatchObject({
      tx_ref: "order-1",
      amount: 7500,
      currency: "NGN",
      status: "successful",
      payment_type: "card",
      auth_model: "PIN",
      app_fee: 105,
      amount_settled: 7395,
      customer: { email: "ada@example.com" },
      card: { last_4digits: "2950" },
    })
  })

  it("sends charge.completed with the secret hash and an HMAC of the body", async () => {
    await payWithPinCard(await newLink("order-2"))
    await fw.pass(0)

    const [post] = fw.posted

    expect(post?.headers.get("verif-hash")).toBe(SECRET_HASH)
    expect(post?.headers.get("flutterwave-signature")).toBe(
      createHmac("sha256", SECRET_HASH)
        .update(post?.body ?? "")
        .digest("base64"),
    )
    expect(chargeWebhooks()).toEqual([
      expect.objectContaining({
        event: "charge.completed",
        data: expect.objectContaining({ tx_ref: "order-2", status: "successful" }),
      }),
    ])
  })

  it("refuses a tx_ref that was used before", async () => {
    await newLink("order-3")

    const again = await call(fw.emulator, "POST", "/v3/payments", {
      tx_ref: "order-3",
      amount: 100,
      redirect_url: "http://app.test/paid",
      customer: { email: "ada@example.com" },
    })

    expect(again).toMatchObject({ http: 400, status: "error", data: null })
  })

  it("keeps the page open after a refused card, with a failed transaction and its webhook", async () => {
    const page = await newLink("order-4")

    await page.submit("card", { card_number: "5258585922666506", expiry: "09/31", cvv: "883" })
    await page.submit("pin", { pin: "3310" })

    const html = await page.submit("otp", { otp: "12345" })

    expect(html).toContain('role="alert"')
    expect(html).toContain("Insufficient Funds")
    expect(page.redirectedTo).toBeUndefined()

    await fw.pass(0)
    expect(chargeWebhooks().map((hook) => hook.data.status)).toEqual(["failed"])

    await payWithPinCard(page)
    expect(page.redirectedTo?.searchParams.get("status")).toBe("successful")
  })

  it("ends a link as failed once its retries are used up", async () => {
    const page = await newLink("order-5", { configurations: { max_retry_attempt: 1 } })

    await page.submit("card", { card_number: "5143010522339965", expiry: "08/32", cvv: "276" })
    await page.submit("pin", { pin: "3310" })
    await page.submit("otp", { otp: "12345" })

    expect(page.redirectedTo?.searchParams.get("status")).toBe("failed")
    expect(await page.html()).toContain("This payment has been completed")
  })

  it("takes 3DS and no-auth cards, refuses the wrong-OTP code, and cancels", async () => {
    const threeDs = await newLink("order-6")

    await threeDs.submit("card", { card_number: "4187427415564246", expiry: "09/32", cvv: "828" })
    expect(await threeDs.submit("otp", { otp: "5548" })).toContain("Wrong OTP")

    const noAuth = await newLink("order-7")

    await noAuth.submit("card", { card_number: "5061460166976054667", expiry: "10/29", cvv: "564" })
    expect(noAuth.redirectedTo?.searchParams.get("status")).toBe("successful")

    const cancelled = await newLink("order-8")

    await cancelled.submit("cancel")
    expect(cancelled.redirectedTo?.searchParams.get("status")).toBe("cancelled")
  })

  it("pays by bank transfer and by mobile money, and fails Flutterwave's failing phone", async () => {
    const transfer = await newLink("order-9")

    await transfer.submit("bank-transfer")
    expect(transfer.redirectedTo?.searchParams.get("status")).toBe("successful")

    const mobile = await newLink("order-10")

    await mobile.submit("mobile-money", { phone: "0541234567" })
    expect(await mobile.submit("mobile-otp", { otp: "000000" })).toContain("Invalid OTP")
    await mobile.submit("mobile-otp", { otp: "123456" })
    expect(mobile.redirectedTo?.searchParams.get("status")).toBe("successful")

    const failing = await newLink("order-11")

    expect(await failing.submit("mobile-money", { phone: "233121212121" })).toContain(
      "Mocked a Failed Transaction",
    )
  })

  it("disables a link", async () => {
    const page = await newLink("order-12")
    const link = page.link.toString()
    const disabled = await call(fw.emulator, "POST", "/v3/payments/link/disable", { link })

    expect(disabled).toMatchObject({ status: "success", message: "LINK DISABLED", data: true })
    expect(await page.html()).toContain("currently inactive")
    expect(await call(fw.emulator, "POST", "/v3/payments/link/disable", { link })).toMatchObject({
      http: 400,
      message: "This payment link is currently inactive",
    })
  })
})

describe("transactions", () => {
  it("verifies by reference, lists with filters, and reports the fee and timeline", async () => {
    await payWithPinCard(await newLink("order-20"))

    const byRef = await call(
      fw.emulator,
      "GET",
      "/v3/transactions/verify_by_reference?tx_ref=order-20",
    )
    const id = dataOf(byRef, Transaction).id
    const listed = await call(
      fw.emulator,
      "GET",
      "/v3/transactions?status=successful&customer_email=ada@example.com",
    )
    const fee = await call(fw.emulator, "GET", "/v3/transactions/fee?amount=1000&currency=NGN")
    const events = await call(fw.emulator, "GET", `/v3/transactions/${id}/events`)

    expect(dataOf(listed, z.array(Transaction)).map((tx) => tx.tx_ref)).toEqual(["order-20"])
    expect(listed.meta).toEqual({ page_info: { total: 1, current_page: 1, total_pages: 1 } })
    expect(fee.data).toMatchObject({ fee: 14, charge_amount: 1014 })
    expect(
      dataOf(events, z.array(z.object({ type: z.string() }))).map((event) => event.type),
    ).toEqual(["initiate", "successful"])
    expect(await call(fw.emulator, "GET", "/v3/transactions/999/verify")).toMatchObject({
      http: 400,
      message: "No transaction was found for this id",
    })
  })

  it("refunds part of a payment, then refuses more than is left", async () => {
    await payWithPinCard(await newLink("order-21"))

    const [tx] = flutterwaveLedger(fw.emulator).transactions()
    const refund = await call(fw.emulator, "POST", `/v3/transactions/${tx?.id}/refund`, {
      amount: 5000,
      comments: "Out of stock",
    })

    expect(refund).toMatchObject({
      message: "Transaction refund initiated",
      data: { amount_refunded: 5000, status: "completed", tx_id: tx?.id },
    })
    expect(
      await call(fw.emulator, "POST", `/v3/transactions/${tx?.id}/refund`, { amount: 3000 }),
    ).toMatchObject({
      http: 400,
      status: "error",
    })
  })

  it("resends a transaction's webhook", async () => {
    await payWithPinCard(await newLink("order-22"))

    const [tx] = flutterwaveLedger(fw.emulator).transactions()

    await call(fw.emulator, "POST", `/v3/transactions/${tx?.id}/resend-hook`)
    await fw.pass(0)

    expect(chargeWebhooks().map((hook) => hook.data.tx_ref)).toEqual(["order-22", "order-22"])
  })
})

/** The faults offered for a call, as short labels. */
function kinds(method: string, path: string): string[] {
  return flutterwaveOutboundFaults({ method, path }).map((fault) =>
    fault.kind === "status" ? `status ${fault.status}` : fault.kind,
  )
}

describe("faults", () => {
  it("offers a pending verification, smaller sets for reads and the hosted page, and reset-after on writes", () => {
    expect(kinds("GET", "/v3/transactions/12/verify")).toEqual([
      "status 429",
      "status 500",
      "status 200",
      "reset",
    ])
    expect(kinds("GET", "/v3/hosted/pay/flwlnk-1")).toEqual(["status 500", "reset"])
    expect(kinds("GET", "/v3/banks/NG")).toEqual(["status 429", "status 500", "reset"])
    expect(kinds("POST", "/v3/payments")).toContain("reset-after")
  })
})
