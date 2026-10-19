import type { Context } from "../../http.ts"
import { requireIntegration } from "../auth.ts"
import type { PaystackRouteContext } from "../context.ts"
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

    return ok(c, "Banks retrieved", banks, { meta: { next: null, previous: null, perPage: 50 } })
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
