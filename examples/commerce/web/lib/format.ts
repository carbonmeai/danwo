/** Formatting shared by the storefront and the admin. */

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

/** `1800` as `$18.00`. */
export function money(cents: number): string {
  return USD.format(cents / 100)
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
})

/** An ISO time as `21 Oct, 09:30`. */
export function when(iso: string): string {
  return DATE.format(new Date(iso))
}

/** What an order's status reads as. */
export const STATUS_LABEL = { paid: "Paid", refunding: "Refunding", refunded: "Refunded" } as const

/** Names the shop gives its categories. */
export const CATEGORIES = [
  { slug: "mugs", name: "Mugs" },
  { slug: "notebooks", name: "Notebooks" },
  { slug: "prints", name: "Prints" },
] as const
