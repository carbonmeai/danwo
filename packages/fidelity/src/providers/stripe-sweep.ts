/**
 * Finding what earlier Stripe runs left in a test-mode account: customers whose email carries the
 * fidelity tag (deleted, which also cancels their subscriptions) and active products whose name
 * does (archived with their prices, since neither can be deleted once used). Customers and
 * products named the way runs named them before they were tagged are listed, never touched.
 */
import type { ScenarioContext, Target } from "../scenario.ts"
import { asJsonObject, isJsonArray, type Json, readJson } from "../shape.ts"
import { isTagged, type Leftover } from "../sweep.ts"

type Call = (
  context: Pick<ScenarioContext, "target">,
  method: string,
  path: string,
  values?: Readonly<Record<string, unknown>>,
) => Request

/** How many pages of 100 each list is read to: enough for a test account's leftovers. */
const PAGES = 20

/** Customers that earlier, untagged runs made: `fidelity+…` and `other+…` at example.com. */
const OLD_CUSTOMER = /^(fidelity|other)\+[0-9a-z]+@example\.com$/
/** Products that earlier, untagged runs made. */
const OLD_PRODUCT = /^Fidelity( plan)? [0-9a-z]+$/

interface Item {
  readonly id: string
  readonly fields: Readonly<Record<string, Json>>
}

function itemsOf(body: Json): Item[] {
  const data = asJsonObject(body)?.["data"]

  if (data === undefined || !isJsonArray(data)) return []

  return data.flatMap((value) => {
    const fields = asJsonObject(value)
    const id = fields?.["id"]

    return fields !== undefined && typeof id === "string" ? [{ id, fields }] : []
  })
}

/** Every item of a Stripe list, page by page. */
async function listAll(
  target: Target,
  call: Call,
  path: string,
  values: Readonly<Record<string, unknown>> = {},
): Promise<Item[]> {
  const items: Item[] = []
  let after: string | undefined

  for (let page = 0; page < PAGES; page++) {
    const answer = await target.send(
      call({ target }, "GET", path, {
        ...values,
        limit: 100,
        ...(after !== undefined && { starting_after: after }),
      }),
    )
    const body = await readJson(answer)
    const found = itemsOf(body)

    items.push(...found)
    after = found.at(-1)?.id
    if (asJsonObject(body)?.["has_more"] !== true || after === undefined) break
  }

  return items
}

function text(item: Item, name: string): string {
  const value = item.fields[name]

  return typeof value === "string" ? value : ""
}

/** Archives a product's active prices, then the product. */
async function archiveProduct(target: Target, call: Call, product: string): Promise<Response> {
  for (const price of await listAll(target, call, "/v1/prices", { product, active: true }))
    await target.send(call({ target }, "POST", `/v1/prices/${price.id}`, { active: false }))

  return target.send(call({ target }, "POST", `/v1/products/${product}`, { active: false }))
}

/** The sweep for Stripe, calling the API the way the rest of the suite does. */
export function stripeSweep(call: Call): (target: Target) => Promise<Leftover[]> {
  return async (target) => {
    const customers = (await listAll(target, call, "/v1/customers")).flatMap((item) => {
      const email = text(item, "email")
      const tagged = isTagged(email)

      if (!tagged && !OLD_CUSTOMER.test(email)) return []

      return [
        {
          kind: "customer",
          id: item.id,
          label: email,
          tagged,
          remove: () => target.send(call({ target }, "DELETE", `/v1/customers/${item.id}`)),
        },
      ]
    })
    const products = (await listAll(target, call, "/v1/products", { active: true })).flatMap(
      (item) => {
        const name = text(item, "name")
        const tagged = isTagged(name)

        if (!tagged && !OLD_PRODUCT.test(name)) return []

        return [
          {
            kind: "product",
            id: item.id,
            label: name,
            tagged,
            remove: () => archiveProduct(target, call, item.id),
          },
        ]
      },
    )

    return [...customers, ...products]
  }
}
