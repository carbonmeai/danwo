import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

import { flutterwaveBank, flutterwaveLedger } from "../src/flutterwave/index.ts"
import {
  call,
  dataOf,
  HostedPage,
  payWithPinCard,
  type TestFlutterwave,
  testFlutterwave,
} from "./flutterwave-client.ts"

const Transfer = z.object({
  id: z.number(),
  status: z.string(),
  amount: z.number(),
  fee: z.number(),
  full_name: z.string(),
  bank_name: z.string(),
  reference: z.string(),
})
const Balance = z.object({ available_balance: z.number() })
const Hook = z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) })

const MINUTE = 60_000

let fw: TestFlutterwave

beforeEach(() => {
  fw = testFlutterwave({ balances: { NGN: 100_000 } })
})

/** The events of the webhooks delivered so far, with their data's status. */
function hooks(): string[] {
  return fw.posted.map((post) => {
    const hook = Hook.parse(JSON.parse(post.body))

    return `${hook.event} ${String(hook.data["status"])}`
  })
}

async function transfer(reference: string, extra: Record<string, unknown> = {}) {
  return call(fw.emulator, "POST", "/v3/transfers", {
    account_bank: "044",
    account_number: "0690000032",
    amount: 5000,
    narration: "Payout",
    currency: "NGN",
    reference,
    ...extra,
  })
}

async function ngnBalance(): Promise<number> {
  return dataOf(await call(fw.emulator, "GET", "/v3/balances/NGN"), Balance).available_balance
}

describe("transfers", () => {
  it("queues a transfer, settles a _PMCK reference after its minutes, and sends transfer.completed", async () => {
    const queued = await transfer("payout-1_PMCKDU_1")

    expect(queued).toMatchObject({ message: "Transfer Queued Successfully" })
    expect(dataOf(queued, Transfer)).toMatchObject({
      status: "NEW",
      fee: 26.875,
      bank_name: "Access Bank",
    })

    const id = dataOf(queued, Transfer).id

    expect(dataOf(await call(fw.emulator, "GET", `/v3/transfers/${id}`), Transfer).status).toBe(
      "PENDING",
    )

    await fw.pass(MINUTE)

    expect(dataOf(await call(fw.emulator, "GET", `/v3/transfers/${id}`), Transfer).status).toBe(
      "SUCCESSFUL",
    )
    expect(hooks()).toEqual(["transfer.completed SUCCESSFUL"])
    expect(await ngnBalance()).toBe(100_000 - 5026.875)
  })

  it("fails a _PMCK_ST_F transfer, gives the money back, and retries it", async () => {
    const failed = dataOf(await transfer("payout-2_PMCK_ST_FDU_1"), Transfer)

    await fw.pass(MINUTE)

    expect(hooks()).toEqual(["transfer.completed FAILED"])
    expect(await ngnBalance()).toBe(100_000)

    const retry = await call(fw.emulator, "POST", `/v3/transfers/${failed.id}/retries`)
    const retries = await call(fw.emulator, "GET", `/v3/transfers/${failed.id}/retries`)

    expect(retry.message).toBe("Transfer retry attempt queued.")
    expect(dataOf(retries, z.array(Transfer))).toHaveLength(1)
  })

  it("leaves a plain reference pending, as test mode does", async () => {
    const pending = dataOf(await transfer("payout-3"), Transfer)

    await fw.pass(60 * MINUTE)

    expect(
      dataOf(await call(fw.emulator, "GET", `/v3/transfers/${pending.id}`), Transfer).status,
    ).toBe("PENDING")
  })

  it("refuses the blacklisted account, an unknown account and a transfer the balance cannot cover", async () => {
    expect(await transfer("x", { account_number: "0690000036" })).toMatchObject({
      http: 400,
      message: "Payout was made to a blacklisted account number",
    })
    expect(await transfer("y", { account_number: "1234567890" })).toMatchObject({
      http: 400,
      message: "Sorry, recipient account could not be validated. Please try again",
    })
    expect(await transfer("z", { amount: 1_000_000 })).toMatchObject({ http: 400, status: "error" })
  })

  it("sends a transfer's change to its callback URL when it names one", async () => {
    await transfer("payout-4_PMCKDU_1", { callback_url: "http://app.test/payouts/callback" })
    await fw.pass(MINUTE)

    expect(fw.posted.map((post) => post.url)).toEqual(["http://app.test/payouts/callback"])
  })

  it("lists banks, resolves accounts, and keeps beneficiaries", async () => {
    const banks = await call(fw.emulator, "GET", "/v3/banks/NG")
    const resolved = await call(fw.emulator, "POST", "/v3/accounts/resolve", {
      account_number: "0690000032",
      account_bank: "044",
    })
    const created = await call(fw.emulator, "POST", "/v3/beneficiaries", {
      account_bank: "044",
      account_number: "0690000032",
    })
    const id = dataOf(created, z.object({ id: z.number() })).id

    expect(
      dataOf(banks, z.array(z.object({ code: z.string() }))).map((bank) => bank.code),
    ).toContain("044")
    expect(resolved.data).toEqual({ account_number: "0690000032", account_name: "Pastor Bright" })
    expect(await call(fw.emulator, "GET", `/v3/beneficiaries/${id}`)).toMatchObject({
      status: "success",
    })
    expect(await call(fw.emulator, "DELETE", `/v3/beneficiaries/${id}`)).toMatchObject({
      status: "success",
    })
    expect(await call(fw.emulator, "GET", `/v3/beneficiaries/${id}`)).toMatchObject({ http: 404 })
  })
})

describe("payment plans and subscriptions", () => {
  it("subscribes a customer who pays for a plan, charges every interval, and cancels", async () => {
    const plan = await call(fw.emulator, "POST", "/v3/payment-plans", {
      amount: 5000,
      name: "Monthly credits",
      interval: "monthly",
    })
    const planId = dataOf(plan, z.object({ id: z.number(), plan_token: z.string() })).id
    const link = await call(fw.emulator, "POST", "/v3/payments", {
      tx_ref: "sub-1",
      amount: 5000,
      redirect_url: "http://app.test/paid",
      customer: { email: "ada@example.com" },
      payment_plan: planId,
    })

    await payWithPinCard(
      new HostedPage(fw.emulator, dataOf(link, z.object({ link: z.string() })).link),
    )

    const subscriptions = await call(fw.emulator, "GET", "/v3/subscriptions?email=ada@example.com")
    const [subscription] = dataOf(
      subscriptions,
      z.array(z.object({ id: z.number(), status: z.string() })),
    )

    expect(subscription?.status).toBe("active")

    fw.clock.advance(31 * 24 * 60 * MINUTE)
    expect(flutterwaveLedger(fw.emulator).renewDue()).toBe(1)
    expect(flutterwaveLedger(fw.emulator).transactions()).toHaveLength(2)

    const cancelled = await call(fw.emulator, "PUT", `/v3/subscriptions/${subscription?.id}/cancel`)

    await fw.pass(0)
    expect(cancelled.message).toBe("Subscription cancelled")
    expect(hooks()).toEqual([
      "charge.completed successful",
      "charge.completed successful",
      "subscription.cancelled cancelled",
    ])
  })

  it("lists, updates and cancels plans, and refuses an unknown interval", async () => {
    const bad = await call(fw.emulator, "POST", "/v3/payment-plans", {
      amount: 100,
      name: "Bad",
      interval: "fortnightly",
    })
    const plan = await call(fw.emulator, "POST", "/v3/payment-plans", {
      amount: 100,
      name: "Weekly",
      interval: "weekly",
    })
    const id = dataOf(plan, z.object({ id: z.number() })).id

    expect(bad).toMatchObject({ http: 400 })
    expect(
      await call(fw.emulator, "PUT", `/v3/payment-plans/${id}`, { name: "Weekly plus" }),
    ).toMatchObject({
      data: { name: "Weekly plus" },
    })
    expect(await call(fw.emulator, "PUT", `/v3/payment-plans/${id}/cancel`)).toMatchObject({
      data: { status: "cancelled" },
    })
    expect((await call(fw.emulator, "GET", "/v3/payment-plans")).meta).toEqual({
      page_info: { total: 1, current_page: 1, total_pages: 1 },
    })
  })
})

describe("virtual accounts", () => {
  it("opens a dynamic account and records a transfer into it as a payment", async () => {
    const opened = await call(fw.emulator, "POST", "/v3/virtual-account-numbers", {
      email: "ada@example.com",
      amount: 2000,
      tx_ref: "va-1",
      firstname: "Ada",
      lastname: "Lovelace",
      narration: "Acme",
    })
    const account = dataOf(opened, z.object({ account_number: z.string(), order_ref: z.string() }))
    const paid = flutterwaveBank(fw.emulator).transferIn({
      accountNumber: account.account_number,
      amount: 2000,
    })

    await fw.pass(0)
    expect(paid).toMatchObject({
      tx_ref: "va-1",
      payment_type: "bank_transfer",
      status: "successful",
    })
    expect(hooks()).toEqual(["charge.completed successful"])
    expect(
      await call(fw.emulator, "GET", `/v3/virtual-account-numbers/${account.order_ref}`),
    ).toMatchObject({
      status: "success",
    })
  })

  it("asks for a BVN before opening a permanent account", async () => {
    expect(
      await call(fw.emulator, "POST", "/v3/virtual-account-numbers", {
        email: "ada@example.com",
        is_permanent: true,
      }),
    ).toMatchObject({ http: 400, message: "BVN is required for static account number generation" })
  })
})
