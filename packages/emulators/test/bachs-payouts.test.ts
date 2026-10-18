import { BachsApiError } from "@bachs/sdk"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { bachsLedger, bachsOutboundFaults } from "../src/bachs/index.ts"
import { type BachsHarness, startBachs } from "./bachs-client.ts"

let bachs: BachsHarness

beforeEach(async () => {
  bachs = await startBachs({
    balances: { USD: "1000.00", NGN: "50000.00" },
    destinations: [
      { id: "pd_failing", currency: "NGN", account_number: "0987654321", fails: true },
    ],
  })
})

afterEach(async () => {
  await bachs.close()
})

describe("Bachs payouts", () => {
  it("saves a destination, pays out the same currency with a fee on top, and reports payout.paid", async () => {
    const destination = await bachs.client.payoutDestinations.create({
      type: "bank_account",
      currency: "USD",
      account_number: "3010001234567",
      name: "Ops",
    })

    expect(destination).toMatchObject({ status: "approved", is_usable: true, currency: "USD" })

    const payout = await bachs.client.payouts.create({
      destination: destination.id,
      amount: "500.00",
      reference: "payout_1",
    })

    expect(payout).toMatchObject({
      status: "processing",
      amount: "500.00",
      fee: "2.50",
      total_debited: "502.50",
    })
    expect(bachsLedger(bachs.emulator).balance("USD")).toBe("497.50")

    await bachs.pass(2000)

    expect(await bachs.client.payouts.get(payout.id)).toMatchObject({ status: "completed" })
    expect(bachs.types()).toEqual(["payout.created", "payout.paid"])
    expect(bachs.delivered.at(-1)?.event.data).toMatchObject({
      withdrawal_id: payout.id,
      withdrawal_fee: "2.50",
      reference: "payout_1",
    })
  })

  it("converts through a 30-second quote", async () => {
    const destination = await bachs.client.payoutDestinations.create({
      type: "bank_account",
      currency: "NGN",
      bank_code: "058",
      account_number: "0123456789",
    })
    const quote = await bachs.client.payoutQuotes.create({
      from_currency: "USD",
      to_currency: "NGN",
      amount: "100.00",
    })

    expect(quote).toMatchObject({ from_amount: "100.00", to_amount: "150000.00" })

    await bachs.pass(31_000)

    const expired = await bachs.call("POST", "/v1/payouts", {
      destination: destination.id,
      quote_id: quote.quote_id,
    })

    expect(await expired.json()).toMatchObject({ error_code: "QUOTE_EXPIRED" })

    const fresh = await bachs.client.payoutQuotes.create({
      from_currency: "USD",
      to_currency: "NGN",
      amount: "100.00",
    })
    const payout = await bachs.client.payouts.create({
      destination: destination.id,
      quote_id: fresh.quote_id,
    })

    expect(payout).toMatchObject({ currency: "NGN", amount: "150000.00", source_currency: "USD" })
  })

  it("refuses a payout the balance cannot cover, and returns the money when a payout fails", async () => {
    const refused = await bachs.client.payouts
      .create({ destination: "pd_failing", amount: "60000.00" })
      .catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(BachsApiError)
    expect(refused instanceof BachsApiError && refused.errorCode).toBe("INSUFFICIENT_BALANCE")

    await bachs.client.payouts.create({ destination: "pd_failing", amount: "1000.00" })
    await bachs.pass(2000)

    expect(bachs.types()).toContain("payout.failed")
    expect(bachsLedger(bachs.emulator).balance("NGN")).toBe("50000.00")
  })

  it("reads balances and banks, and resolves an account number", async () => {
    const balances = await bachs.client.balances.get()

    expect(balances.balances.map((row) => [row.currency, row.available_balance])).toEqual([
      ["USD", "1000.00"],
      ["NGN", "50000.00"],
    ])
    expect((await bachs.client.banks.list()).banks.length).toBeGreaterThan(0)
    expect(
      await bachs.client.banks.resolveAccount({ account_number: "0123456789", bank_code: "058" }),
    ).toMatchObject({ resolved: true })
  })
})

describe("Bachs virtual accounts", () => {
  it("gives one fixed NGN number, and a deposit into it becomes a payment with sender details", async () => {
    const created = await bachs.call("POST", "/v1/virtual-accounts", { currency: "NGN" })
    const again = await bachs.call("POST", "/v1/virtual-accounts", { currency: "NGN" })

    expect(created.status).toBe(201)
    expect(again.status).toBe(200)

    const account = await created.json()

    expect((await again.json())["account_number"]).toBe(account["account_number"])

    bachsLedger(bachs.emulator).deposit({
      amount: "250000.00",
      senderName: "JANE ADEYEMI",
      narration: "INV-1042",
    })
    await bachs.pass(0)

    expect(bachs.delivered.at(-1)?.event.data).toMatchObject({
      checkout_id: null,
      amount: "250000.00",
      processing_fee: "300.00",
      settlement_amount: "249700.00",
      payment_method_details: {
        type: "bank_transfer",
        bank_transfer: { sender_name: "JANE ADEYEMI", narration: "INV-1042" },
      },
    })
    expect(bachsLedger(bachs.emulator).balance("NGN")).toBe("299700.00")
  })
})

describe("Bachs faults", () => {
  it("faults API writes harder than reads and leaves the hosted pages alone", () => {
    const write = bachsOutboundFaults({ method: "POST", host: "sandbox-api.bachs.io" })
    const read = bachsOutboundFaults({ method: "GET", host: "sandbox-api.bachs.io" })

    expect(write.map((fault) => fault.kind)).toEqual([
      "status",
      "status",
      "status",
      "delay",
      "reset",
      "reset-after",
    ])
    expect(read.map((fault) => fault.kind)).toEqual(["status", "status", "reset"])
    expect(bachsOutboundFaults({ method: "POST", host: "checkout.bachs.io" })).toEqual([])

    const limited = write[0]

    expect(limited?.kind === "status" && JSON.parse(limited.body)).toMatchObject({
      error_code: "TOO_MANY_REQUESTS",
    })
  })
})
