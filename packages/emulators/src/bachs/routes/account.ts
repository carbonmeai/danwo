import { usdPerUnit } from "../balance.ts"
import type { BachsContext } from "../context.ts"
import type { VirtualAccount, WebhookEndpointRecord } from "../entities.ts"
import { balancesObject, endpointObject, virtualAccountObject } from "../formatters.ts"
import {
  BachsFailure,
  bachsId,
  bodyOf,
  type Changes,
  hex,
  invalid,
  iso,
  listPage,
  notFound,
  text,
} from "../helpers.ts"

/** Nigerian banks the reference list answers with. */
const NG_BANKS = [
  { name: "Access Bank", code: "044" },
  { name: "Guaranty Trust Bank", code: "058" },
  { name: "Zenith Bank", code: "057" },
  { name: "First Bank of Nigeria", code: "011" },
  { name: "United Bank for Africa", code: "033" },
]

/** A stable ten-digit account number for the `n`th virtual account. */
function accountNumber(n: number): string {
  return `99${String(28_473_610 + n).padStart(8, "0")}`
}

function newVirtualAccount(context: BachsContext, currency: string): VirtualAccount {
  return {
    id: bachsId("va", 12),
    currency,
    accountNumber: accountNumber(context.bachs.virtualAccounts.all().length),
    bankName: "Danwo Test Bank",
    bankCode: "000",
    createdAt: iso(context.clock()),
  }
}

/** The event types a webhook endpoint subscribes to, from a request. */
function eventTypesOf(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string")
  )
    invalid("event_types must list at least one event type", {
      field: "event_types",
      message: "Field required",
      type: "missing",
    })

  return value
}

function newEndpoint(context: BachsContext, body: Record<string, unknown>): WebhookEndpointRecord {
  const url = text(body, "url")

  if (!url)
    invalid("Missing required field(s): url", {
      field: "url",
      message: "Field required",
      type: "missing",
    })

  const now = iso(context.clock())

  return {
    id: `whe_${hex(16)}`,
    name: text(body, "name") ?? null,
    url,
    enabled: body["enabled"] !== false,
    eventTypes: eventTypesOf(body["event_types"]),
    secret: `whsec_${hex(24)}`,
    createdAt: now,
    updatedAt: now,
  }
}

function endpointChanges(body: Record<string, unknown>): Changes<WebhookEndpointRecord> {
  const changes: Changes<WebhookEndpointRecord> = {}
  const url = text(body, "url")
  const name = text(body, "name")

  if (url) changes.url = url
  if (name !== undefined) changes.name = name
  if (typeof body["enabled"] === "boolean") changes.enabled = body["enabled"]
  if ("event_types" in body) changes.eventTypes = eventTypesOf(body["event_types"])

  return changes
}

/** Balances, bank reference data, virtual accounts and webhook endpoints. */
export function accountRoutes(context: BachsContext): void {
  const { app, bachs } = context
  const endpoint = (id: string) => bachs.endpoints.get(id) ?? notFound("Webhook endpoint")

  app.get("/v1/balances", (c) => c.json(balancesObject(bachs, usdPerUnit)))

  app.get("/v1/reference/banks", (c) =>
    c.json({ country: c.req.query("country") ?? "NG", banks: NG_BANKS }),
  )

  app.post("/v1/misc/bank-accounts/resolve", async (c) => {
    const body = await bodyOf(c)
    const number = text(body, "account_number") ?? ""
    const resolved = /^\d{10}$/.test(number) && number !== "0000000000"

    return c.json({
      resolved,
      account_name: resolved ? "DANWO TEST ACCOUNT" : null,
      account_number: resolved ? number : null,
      message: resolved ? null : "Account could not be resolved",
    })
  })

  app.post("/v1/virtual-accounts", async (c) => {
    const currency = text(await bodyOf(c), "currency")?.toUpperCase() ?? "NGN"

    if (currency !== "NGN")
      throw new BachsFailure(
        400,
        "VIRTUAL_ACCOUNT_CURRENCY_NOT_SUPPORTED",
        `Virtual accounts are not available in ${currency}`,
      )

    const existing = bachs.virtualAccounts.where((account) => account.currency === currency)[0]

    if (existing) return c.json(virtualAccountObject(existing), 200)

    return c.json(
      virtualAccountObject(bachs.virtualAccounts.add(newVirtualAccount(context, currency), null)),
      201,
    )
  })

  app.get("/v1/virtual-accounts", (c) => {
    const currency = c.req.query("currency")?.toUpperCase() ?? "NGN"
    const account =
      bachs.virtualAccounts.where((item) => item.currency === currency)[0] ??
      notFound("Virtual account")

    return c.json(virtualAccountObject(account))
  })

  app.post("/v1/webhooks/endpoints", async (c) => {
    const created = bachs.endpoints.add(newEndpoint(context, await bodyOf(c)), null)

    return c.json({ ...endpointObject(created), secret: created.secret }, 201)
  })

  app.get("/v1/webhooks/endpoints", (c) =>
    c.json(listPage(c, bachs.endpoints.all().map(endpointObject))),
  )
  app.get("/v1/webhooks/endpoints/:id", (c) => c.json(endpointObject(endpoint(c.req.param("id")))))
  app.get("/v1/webhooks/endpoints/:id/secret", (c) =>
    c.json({ secret: endpoint(c.req.param("id")).secret }),
  )

  app.patch("/v1/webhooks/endpoints/:id", async (c) => {
    const found = endpoint(c.req.param("id"))
    const changed = bachs.endpoints.change(found.id, {
      ...endpointChanges(await bodyOf(c)),
      updatedAt: iso(context.clock()),
    })

    return c.json(endpointObject(changed ?? found))
  })

  app.delete("/v1/webhooks/endpoints/:id", (c) => {
    bachs.endpoints.remove(endpoint(c.req.param("id")).id)

    return c.body(null, 204)
  })
}
