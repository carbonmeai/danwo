/**
 * The storefront's client for the shop's API. Pages and route handlers call it on the server, so
 * the browser only ever talks to the storefront. Every answer is checked against its schema.
 */
import { z } from "zod"

/** Where the API answers; the test environment sets it to the API it started. */
function apiUrl(): string {
  return process.env.API_URL ?? "http://127.0.0.1:4400"
}

export const Product = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string(),
  priceCents: z.number(),
  currency: z.string(),
  stock: z.number(),
})
export type Product = z.infer<typeof Product>

const CartLine = z.object({
  slug: z.string(),
  name: z.string(),
  unitCents: z.number(),
  stock: z.number(),
  quantity: z.number(),
})
export type CartLine = z.infer<typeof CartLine>

export const Cart = z.object({ id: z.string(), lines: z.array(CartLine), totalCents: z.number() })
export type Cart = z.infer<typeof Cart>

export const Order = z.object({
  id: z.number(),
  number: z.string(),
  email: z.string(),
  status: z.enum(["paid", "refunding", "refunded"]),
  totalCents: z.number(),
  createdAt: z.string(),
  receiptSent: z.boolean(),
  lines: z.array(z.object({ name: z.string(), quantity: z.number(), unitCents: z.number() })),
})
export type Order = z.infer<typeof Order>

export const StockRow = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  priceCents: z.number(),
  stock: z.number(),
  sold: z.number(),
})

export const PaymentState = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ordered"), orderId: z.number() }),
  z.object({ state: z.enum(["paid", "unpaid"]) }),
])

const Failure = z.object({ error: z.string() })

/** An answer from the API that was not a success, with the message to show. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Calls the API and parses its JSON answer with `schema`; a failure throws an `ApiError`. */
export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init: { readonly method?: string; readonly body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`, {
    method: init.method ?? "GET",
    cache: "no-store",
    ...(init.body !== undefined && {
      body: JSON.stringify(init.body),
      headers: { "content-type": "application/json" },
    }),
  })
  const json: unknown = await res.json().catch(() => ({}))

  if (!res.ok) {
    const failure = Failure.safeParse(json)

    throw new ApiError(
      res.status,
      failure.success ? failure.data.error : `API answered ${res.status}`,
    )
  }

  return schema.parse(json)
}

/** The API's URL for a path, for a route handler that streams the answer on as it is. */
export function apiPath(path: string): string {
  return `${apiUrl()}${path}`
}
