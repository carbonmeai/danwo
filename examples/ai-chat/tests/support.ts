/**
 * What the support assistant's tests share: their fixtures, the steps every chat takes, and the
 * invariants that must hold however a conversation went.
 */
import {
  type DanwoFixtures,
  type LlmFixtures,
  type ResendFixtures,
  resendInbox,
  test as base,
} from "@danwo/sdk"

import { ticketSubject } from "../lib/mail.ts"
import { OUTCOME_NOTES, type SupportMessage, textOf } from "../lib/messages.ts"
import { TicketInput, ticketNumber } from "../lib/tickets.ts"
import { sql } from "./db.ts"

/** The worker's own database, which `danwo.config.ts` hands every test. */
interface SupportFixtures {
  readonly databaseUrl: string
}

export const test = base.extend<LlmFixtures & ResendFixtures & SupportFixtures>()

type Fixtures = DanwoFixtures & LlmFixtures & ResendFixtures & SupportFixtures
type Screen = DanwoFixtures["screen"]
type Expect = DanwoFixtures["expect"]

/** The chat on the page, whose `data-status` says whether an answer is still coming. */
export function chat(screen: Screen) {
  return screen.getByRole("region", { name: "Support chat" })
}

/** Types `question` into the composer and sends it. */
export async function ask(screen: Screen, question: string): Promise<void> {
  await screen.getByLabel("Message").fill(question)
  await screen.getByRole("button", { name: "Send" }).click()
}

/** Waits until no answer is on its way: it ended, or failed. */
export async function settled(screen: Screen, expect: Expect, timeout = 15_000): Promise<void> {
  await expect(chat(screen)).toHaveAttribute("data-status", /^(ready|error)$/, { timeout })
}

/** A message as the page showed it or Postgres kept it: who said it, what, and how it ended. */
interface Said {
  readonly role: string | null
  readonly text: string
  readonly outcome: string | null
}

/** The conversation as the page shows it, oldest first. */
export async function shownMessages(screen: Screen): Promise<Said[]> {
  const items = await screen.getByTestId("message").all()

  return Promise.all(
    items.map(async (item) => {
      const text = item.getByTestId("message-text")

      return {
        role: await item.getAttribute("data-role"),
        text: (await text.count()) > 0 ? (await text.innerText()).trim() : "",
        outcome: await item.getAttribute("data-outcome"),
      }
    }),
  )
}

/** Every saved conversation's messages, each conversation oldest first. */
async function savedConversations(databaseUrl: string): Promise<SupportMessage[][]> {
  const rows = await sql<{ conversation_id: string; message: SupportMessage }>(
    databaseUrl,
    "select conversation_id, message from messages order by conversation_id, position",
  )
  const byConversation = new Map<string, SupportMessage[]>()

  for (const row of rows)
    byConversation.set(row.conversation_id, [
      ...(byConversation.get(row.conversation_id) ?? []),
      row.message,
    ])

  return [...byConversation.values()]
}

/** The one saved conversation as the page would show it. */
export async function storedMessages(databaseUrl: string): Promise<Said[]> {
  const conversations = await savedConversations(databaseUrl)

  if (conversations.length > 1) throw new Error(`${conversations.length} conversations were saved`)

  return (conversations[0] ?? []).map((message) => ({
    role: message.role,
    text: textOf(message),
    outcome: message.role === "assistant" ? (message.metadata?.outcome ?? "interrupted") : null,
  }))
}

/** A ticket as the invariants read it, with the email of the order it is about (if there is one). */
interface Ticket {
  readonly id: string
  readonly conversation_id: string
  readonly order_number: string
  readonly reason: string | null
  readonly summary: string
  readonly email: string | null
}

/** Every ticket in the database. */
export function tickets(databaseUrl: string): Promise<Ticket[]> {
  return sql<Ticket>(
    databaseUrl,
    `select t.id::text, t.conversation_id, t.order_number, t.reason, t.summary, o.email
       from tickets t left join orders o on o.number = t.order_number order by t.id`,
  )
}

/** Text no customer should read: the provider's or the SDK's own error, as it came. */
const RAW_ERROR =
  /rate limit|too many requests|server had an error|internal server error|overloaded|context window|cannot connect|fetch failed|status code|AI_[A-Za-z]+Error|APICallError|gateway|danwo:/i

/**
 * What must hold after any conversation, whatever the model, Resend or Postgres did on the way:
 *
 * - **tool writes only happen with valid arguments:** every ticket fits `createTicket`'s schema
 *   and is about an order that exists;
 * - **one ticket per request:** at most one ticket per conversation and order;
 * - **one email per ticket:** exactly one ticket email for each ticket, and none for a ticket
 *   that doesn't exist;
 * - **stored messages match what the page showed:** once no answer is coming, the page and
 *   Postgres hold the same conversation, every answer saying how it ended;
 * - **no raw errors:** the page never shows the provider's or the SDK's error text.
 */
export async function supportHeld(fixtures: Fixtures): Promise<void> {
  const { databaseUrl, resend, expect, screen } = fixtures
  const all = await tickets(databaseUrl)

  for (const ticket of all) {
    const input = {
      orderNumber: ticket.order_number,
      reason: ticket.reason,
      summary: ticket.summary,
    }

    const problems = (TicketInput.safeParse(input).error?.issues ?? [])
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ")

    expect(problems, `${ticketNumber(ticket.id)} was opened with valid arguments`).toBe("")
    expect(ticket.email, `${ticketNumber(ticket.id)} is about a real order`).not.toBeNull()
  }

  const keys = all.map((ticket) => `${ticket.conversation_id}/${ticket.order_number}`)

  expect(new Set(keys).size, "one ticket per conversation and order").toBe(keys.length)

  const inbox = resendInbox(resend)
  const ticketMail = (to: string) =>
    inbox.list(to).filter((sent) => sent.subject.startsWith("We've opened ticket"))

  for (const ticket of all) {
    const to = ticket.email ?? ""

    /* The email may still be on its way when a fault slowed the request down. */
    await inbox.waitFor(to)
    expect(
      ticketMail(to).filter((sent) => sent.subject === ticketSubject(ticketNumber(ticket.id))),
      `one email for ${ticketNumber(ticket.id)}`,
    ).toHaveLength(1)
  }

  const recipients = new Set(all.map((ticket) => ticket.email ?? ""))
  const strays = ["ada@example.com", "grace@example.com"]
    .filter((to) => !recipients.has(to))
    .flatMap(ticketMail)

  expect(strays, "no ticket email without a ticket").toEqual([])

  const raw = await screen.getByText(RAW_ERROR).allTextContents()

  expect(raw.join(" | "), "no raw error text on the page").toBe("")

  /* A test that went on to another page has nothing left on screen to compare. */
  if ((await chat(screen).count()) === 0) return

  await settled(screen, expect)
  expect(await shownMessages(screen), "the page shows what Postgres kept").toEqual(
    await storedMessages(databaseUrl),
  )
}

/** The note an answer shows when it didn't end in full. */
export function noteFor(outcome: keyof typeof OUTCOME_NOTES): string {
  return OUTCOME_NOTES[outcome] ?? ""
}
