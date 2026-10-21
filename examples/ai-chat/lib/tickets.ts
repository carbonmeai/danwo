import { z } from "zod"

import { query } from "./db.ts"
import { sendTicketEmail } from "./mail.ts"
import { findOrder } from "./orders.ts"

/** Why a customer needs help, as a ticket files it. */
export const REASONS = ["damaged", "missing", "late", "wrong-item", "other"] as const

/**
 * What `createTicket` takes from the model. The AI SDK checks every call against it before the
 * tool runs, so a call that doesn't fit never reaches the database.
 */
export const TicketInput = z.object({
  orderNumber: z
    .string()
    .regex(/^\d{4}$/)
    .describe("The order's four-digit number, e.g. 1042."),
  reason: z.enum(REASONS).describe("What went wrong with the order."),
  summary: z
    .string()
    .trim()
    .min(10)
    .max(400)
    .describe("One or two sentences on what happened, in the customer's words."),
})

export type TicketInput = z.infer<typeof TicketInput>

/** What opening a ticket came to, as the tool hands it back to the model and the page. */
export type TicketOutcome =
  | {
      readonly status: "opened" | "already-open"
      readonly ticket: string
      readonly orderNumber: string
      readonly email: string
    }
  | { readonly status: "no-such-order"; readonly orderNumber: string }

/** A ticket's number as the customer sees it: `T-0007`. */
export function ticketNumber(id: string | number): string {
  return `T-${String(id).padStart(4, "0")}`
}

/**
 * Opens a ticket about an order for the conversation, and emails the customer a copy, once.
 * Every step is safe to repeat, so a retried request, a regenerated answer or a second ask in
 * the same conversation end with one ticket and one email:
 *
 * 1. the upsert keeps one ticket per conversation and order (`unique`), new or not;
 * 2. a ticket not yet emailed gets its email, keyed by the ticket so Resend sends it once;
 * 3. the ticket is marked emailed.
 */
export async function openTicket(
  conversationId: string,
  input: TicketInput,
): Promise<TicketOutcome> {
  const order = await findOrder(input.orderNumber)

  if (order === undefined) return { status: "no-such-order", orderNumber: input.orderNumber }

  const [row] = await query<{ id: string; emailed: boolean; created: boolean }>(
    `insert into tickets (conversation_id, order_number, reason, summary)
     values ($1, $2, $3, $4)
     on conflict (conversation_id, order_number) do update set order_number = excluded.order_number
     returning id::text, emailed_at is not null as emailed, xmax = 0 as created`,
    [conversationId, order.number, input.reason, input.summary],
  )

  if (row === undefined) throw new Error("the upsert returned no ticket")

  const ticket = ticketNumber(row.id)

  if (!row.emailed) {
    await sendTicketEmail({
      ticket,
      to: order.email,
      customer: order.customer,
      orderNumber: order.number,
      summary: input.summary,
    })
    await query("update tickets set emailed_at = coalesce(emailed_at, now()) where id = $1", [
      row.id,
    ])
  }

  return {
    status: row.created ? "opened" : "already-open",
    ticket,
    orderNumber: order.number,
    email: order.email,
  }
}

/** A ticket as the tickets page lists it. */
export interface TicketRow {
  readonly ticket: string
  readonly orderNumber: string
  readonly reason: string | null
  readonly summary: string
  readonly emailed: boolean
  readonly createdAt: string
}

/** Every ticket, newest first. */
export async function listTickets(): Promise<TicketRow[]> {
  const rows = await query<{
    id: string
    order_number: string
    reason: string | null
    summary: string
    emailed: boolean
    created_at: Date
  }>(
    `select id::text, order_number, reason, summary, emailed_at is not null as emailed, created_at
       from tickets order by id desc`,
  )

  return rows.map((row) => ({
    ticket: ticketNumber(row.id),
    orderNumber: row.order_number,
    reason: row.reason,
    summary: row.summary,
    emailed: row.emailed,
    createdAt: row.created_at.toISOString(),
  }))
}
