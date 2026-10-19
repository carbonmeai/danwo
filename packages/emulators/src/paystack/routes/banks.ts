import type { Context } from "../../http.ts"
import { requireIntegration } from "../auth.ts"
import type { PaystackRouteContext } from "../context.ts"
import type { Bank } from "../entities.ts"
import { dedicatedObject } from "../formatters.ts"
import { accountNumber, fail, nextId, ok, text } from "../helpers.ts"
import { PROBLEMS } from "../problems.ts"
import { customerInBody } from "./customers.ts"

/** The banks a dedicated account can be opened at in test mode. */
const PROVIDERS = [{ provider_slug: "test-bank", bank_id: 1, bank_name: "Test Bank", id: 1 }]

const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  nigeria: "NGN",
  ghana: "GHS",
  "south africa": "ZAR",
  kenya: "KES",
}

async function createDedicated(c: Context, context: PaystackRouteContext): Promise<Response> {
  const { paystack } = context
  const { fields, customer } = await customerInBody(c, paystack)
  const bank = paystack.banks
    .all()
    .find((b) => b.slug === (text(fields, "preferred_bank") ?? "test-bank"))

  if (customer === undefined) return fail(c, 404, "Customer not found", PROBLEMS.customerNotFound)
  if (bank === undefined) return fail(c, 400, "Preferred bank is not available")

  const existing = paystack.dedicated.where(
    (d) => d.customer.customer_code === customer.customer_code,
  )[0]
  const account =
    existing ??
    paystack.dedicated.add(
      dedicatedObject({
        id: nextId(context.store),
        accountNumber: accountNumber(),
        bank,
        customer,
        now: context.clock(),
      }),
      null,
    )

  return ok(c, "NUBAN successfully created", account)
}

/** A cursor naming the bank a page starts after or ends before, opaque as Paystack's are. */
function cursorOf(bank: Bank | undefined): string | null {
  return bank === undefined ? null : Buffer.from(`bank:${bank.id}`).toString("base64")
}

/** The bank id a cursor names; undefined for none or one the emulator did not give. */
function idOf(cursor: string | undefined): number | undefined {
  const match = /^bank:(\d+)$/.exec(Buffer.from(cursor ?? "", "base64").toString())

  return match ? Number(match[1]) : undefined
}

/**
 * One page of banks, as listing with `use_cursor=true` answers: `perPage` banks after the `next`
 * cursor, or before the `previous` one, with the cursors for the pages either side. Without
 * `use_cursor`, Paystack lists every bank at once with no `meta`.
 */
function cursorPage(c: Context, banks: readonly Bank[]): [Bank[], { meta: object }] {
  const perPage = Math.min(Math.max(Number(c.req.query("perPage")) || 50, 1), 100)
  const after = idOf(c.req.query("next"))
  const before = idOf(c.req.query("previous"))
  const start =
    before === undefined
      ? banks.findIndex((bank) => after === undefined || bank.id > after)
      : Math.max(
          banks.findIndex((bank) => bank.id >= before),
          0,
        ) - perPage
  const from = Math.max(start === -1 ? banks.length : start, 0)
  const page = banks.slice(from, from + perPage)
  const last = page.at(-1)

  return [
    page,
    {
      meta: {
        next: last !== undefined && last !== banks.at(-1) ? cursorOf(last) : null,
        previous: from > 0 ? cursorOf(page[0]) : null,
        perPage,
      },
    },
  ]
}

/** Banks, account name resolution, and dedicated virtual accounts. */
export function bankRoutes(context: PaystackRouteContext): void {
  const { app, paystack } = context

  app.get("/bank", (c) => {
    const country = c.req.query("country")?.toLowerCase()
    const currency =
      c.req.query("currency") ?? (country === undefined ? undefined : COUNTRY_CURRENCY[country])
    const banks = paystack.banks.where(
      (bank) => currency === undefined || bank.currency === currency,
    )

    return c.req.query("use_cursor") === "true"
      ? ok(c, "Banks retrieved", ...cursorPage(c, banks))
      : ok(c, "Banks retrieved", banks)
  })

  app.get("/bank/resolve", (c) => {
    const number = c.req.query("account_number") ?? ""
    const code = c.req.query("bank_code") ?? ""
    const known = paystack.accounts.get(`${code}:${number}`)

    if (known === undefined)
      return fail(c, 422, "Could not resolve account name. Check parameters or try again.")

    return ok(c, "Account number resolved", {
      account_number: number,
      account_name: known.accountName,
      bank_id: paystack.banks.get(code)?.id ?? 0,
    })
  })

  app.post("/dedicated_account", (c) => createDedicated(c, context))

  app.get("/dedicated_account/available_providers", (c) =>
    ok(c, "Dedicated account providers retrieved", PROVIDERS),
  )

  app.get("/dedicated_account", (c) => {
    const integration = requireIntegration(c, paystack)
    const mine = paystack.dedicated.where(
      (d) => paystack.customers.get(d.customer.customer_code)?.integration === integration.number,
    )

    return ok(c, "Managed Accounts Successfully Retrieved", mine)
  })
}
