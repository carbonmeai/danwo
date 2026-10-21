import { query } from "./db.ts"

/** An order as the assistant reads it back to the customer. */
export interface Order {
  readonly number: string
  readonly customer: string
  readonly email: string
  readonly item: string
  /** `processing`, `shipped` or `delivered`. */
  readonly status: string
  readonly placedOn: string
  readonly arrivesOn: string | null
}

/** The orders a fresh shop starts with; the tests seed them into every worker's database. */
export const SEED_ORDERS: readonly Order[] = [
  {
    number: "1042",
    customer: "Ada Lovelace",
    email: "ada@example.com",
    item: "Speckled stoneware mug",
    status: "delivered",
    placedOn: "2026-10-12",
    arrivesOn: "2026-10-17",
  },
  {
    number: "1043",
    customer: "Ada Lovelace",
    email: "ada@example.com",
    item: "Dot-grid notebook, A5",
    status: "shipped",
    placedOn: "2026-10-18",
    arrivesOn: "2026-10-23",
  },
  {
    number: "1051",
    customer: "Grace Hopper",
    email: "grace@example.com",
    item: "Tide print, 30 × 40 cm",
    status: "processing",
    placedOn: "2026-10-20",
    arrivesOn: null,
  },
]

interface OrderRow {
  readonly number: string
  readonly customer: string
  readonly email: string
  readonly item: string
  readonly status: string
  readonly placed_on: string
  readonly arrives_on: string | null
}

/** The order numbered `number`, or undefined when there is none. */
export async function findOrder(number: string): Promise<Order | undefined> {
  const [row] = await query<OrderRow>(
    `select number, customer, email, item, status,
            to_char(placed_on, 'YYYY-MM-DD') as placed_on,
            to_char(arrives_on, 'YYYY-MM-DD') as arrives_on
       from orders where number = $1`,
    [number],
  )

  return (
    row && {
      number: row.number,
      customer: row.customer,
      email: row.email,
      item: row.item,
      status: row.status,
      placedOn: row.placed_on,
      arrivesOn: row.arrives_on,
    }
  )
}
