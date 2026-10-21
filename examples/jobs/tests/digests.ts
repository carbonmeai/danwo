/**
 * What the digest tests share: writing and scheduling a digest through the page, and the
 * invariants. Each invariant reads one fact from two sides, the database and a provider's
 * emulator, and must hold however a run went: sent, retried, failed for good or faulted halfway.
 */
import {
  type DanwoFixtures,
  type Emulator,
  type InboxEmail,
  type ResendFixtures,
  resendInbox,
  type StripeFixtures,
  test as base,
  z,
} from "@danwo/sdk"

import type { Sql } from "./db.ts"

/** What every digest test receives: the emulators, settling, and SQL on this worker's database. */
export type DigestFixtures = StripeFixtures & ResendFixtures & { readonly sql: Sql }

export const test = base.extend<DigestFixtures>()

/** Who owns the digests, and hears about a copy that cannot be delivered. */
export const OWNER = "editor@northwind.test"

/** A subscriber as the page asks for one. */
export interface Person {
  readonly name: string
  readonly email: string
}

export const TEAM: readonly Person[] = [
  { name: "Ada Lovelace", email: "ada@northwind.test" },
  { name: "Grace Hopper", email: "grace@northwind.test" },
  { name: "Katherine Johnson", email: "katherine@northwind.test" },
]

/** How many emails one invoice item covers, as the worker batches them. */
const BATCH_SIZE = 50

type Page = Pick<DanwoFixtures, "app" | "screen" | "expect">

/** Writes a digest on the page and adds `subscribers`; the page is left on the digest. */
export async function writeDigest(
  { app, screen, expect }: Page,
  digest: { readonly title: string; readonly subscribers: readonly Person[] },
): Promise<void> {
  await app.open("/digests/new")
  await screen.getByLabel("Title").fill(digest.title)
  await screen.getByLabel("Message").fill("What the team shipped this week.")
  await screen.getByLabel("Owner's email").fill(OWNER)
  await screen.getByRole("button", { name: "Create digest" }).click()
  await expect(screen.getByRole("heading", { name: digest.title })).toBeVisible()

  for (const person of digest.subscribers) {
    await screen.getByLabel("Name").fill(person.name)
    await screen.getByLabel("Email").fill(person.email)
    await screen.getByRole("button", { name: "Add subscriber" }).click()
    await expect(screen.getByRole("cell", { name: person.email, exact: true })).toBeVisible()
  }
}

/** The row of the digest's subscribers table that holds `email`. */
export function subscriberRow(screen: DanwoFixtures["screen"], email: string) {
  return screen
    .getByRole("table", { name: "Subscribers" })
    .getByRole("row")
    .filter({ hasText: email })
}

/** Tomorrow at 09:00 in this machine's time zone, which the page's browser shares. */
export function tomorrowAtNine(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0)
}

/** `at` as a `datetime-local` field holds it. */
function localInput(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * Schedules the open digest for tomorrow at 09:00, then moves time to just past it: the hourly
 * scheduler falls due on the way, and the jobs it starts run before the next step.
 */
export async function scheduleAndArrive({
  screen,
  expect,
  time,
}: Pick<DanwoFixtures, "screen" | "expect" | "time">): Promise<void> {
  const sendAt = tomorrowAtNine(time.now())

  await screen.getByLabel("Send at").fill(localInput(sendAt))
  await screen.getByRole("button", { name: "Schedule" }).click()
  await expect(screen.getByRole("status")).toContainText("Scheduled for")
  await time.set(sendAt.getTime() + 60_000)
}

/** The address in `Name <address>`, or the address itself. */
function addressOf(to: string): string {
  return /<([^>]+)>/.exec(to)?.[1] ?? to
}

interface DeliveryRow {
  readonly digest_id: string
  readonly title: string
  readonly owner_email: string
  readonly digest_status: string
  readonly email: string
  readonly status: string | null
  readonly email_id: string | null
  readonly owner_notified_at: Date | null
}

/** Every subscriber of every digest, with their delivery when there is one. */
function deliveriesOf(sql: Sql): Promise<DeliveryRow[]> {
  return sql<DeliveryRow>(
    `select d.id as digest_id, d.title, d.owner_email, d.status as digest_status, s.email,
            v.status, v.email_id, v.owner_notified_at
       from subscribers s
       join digests d on d.id = s.digest_id
       left join deliveries v on v.subscriber_id = s.id`,
  )
}

/** A digest's copy in the inbox: an email whose subject is the digest's title. */
function digestEmails(resend: Emulator, title: string): InboxEmail[] {
  return resendInbox(resend)
    .list()
    .filter((email) => email.subject === title)
}

/** The owner's notices about a copy that could not be delivered. */
function failureNotices(resend: Emulator, title: string, to: string): InboxEmail[] {
  return resendInbox(resend)
    .list(OWNER)
    .filter((email) => email.subject === `Couldn't deliver "${title}" to ${to}`)
}

const InvoiceItems = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      quantity: z.number(),
      amount: z.number(),
      metadata: z.record(z.string(), z.string()),
    }),
  ),
})

/** The team's invoice items, read from the emulator the way the worker's own client would. */
async function invoiceItems(stripe: Emulator) {
  const res = await stripe.fetch(
    new Request("https://api.stripe.com/v1/invoiceitems?limit=100", {
      headers: { authorization: "Bearer sk_test_northwind_digest" },
    }),
  )

  return InvoiceItems.parse(await res.json()).data
}

/**
 * Every subscriber got each digest that went out once, and the books agree with Resend and Stripe:
 * - no subscriber has two copies of a digest, and every copy in Resend is a delivery marked sent
 *   with that email's id;
 * - once a digest is claimed, each subscriber's copy is sent or failed, none left queued, so
 *   emails = subscribers × digests sent, minus the copies that failed for good;
 * - each failed copy was told to the owner, once;
 * - each batch of a claimed digest is one Stripe invoice item for that many emails, and one
 *   charge row with its id.
 */
export async function expectDigestsDelivered({
  sql,
  resend,
  stripe,
  settle,
  expect,
}: DigestFixtures & Pick<DanwoFixtures, "expect">): Promise<void> {
  await settle()

  const rows = await deliveriesOf(sql)
  const titles = new Set(rows.map((row) => row.title))

  for (const title of titles) {
    const emails = digestEmails(resend, title)
    const recipients = emails.flatMap((email) => email.to.map(addressOf))

    expect(recipients.toSorted(), `"${title}": one copy per subscriber`).toEqual(
      [...new Set(recipients)].toSorted(),
    )

    for (const email of emails) {
      const row = rows.find((r) => r.title === title && email.to.map(addressOf).includes(r.email))

      expect(row?.status, `${email.to.join(", ")}: the copy Resend sent is a sent delivery`).toBe(
        "sent",
      )
      expect(row?.email_id, `${email.to.join(", ")}: the delivery keeps Resend's id`).toBe(email.id)
    }
  }

  for (const row of rows.filter((r) => r.digest_status === "sending")) {
    expect(["sent", "failed"], `${row.email}: "${row.title}" is sent or failed`).toContain(
      row.status,
    )

    const copies = digestEmails(resend, row.title).filter((email) =>
      email.to.map(addressOf).includes(row.email),
    )

    expect(copies, `${row.email}: one copy of "${row.title}"`).toHaveLength(
      row.status === "sent" ? 1 : 0,
    )

    if (row.status === "failed") {
      expect(row.owner_notified_at, `${row.email}: the owner was told`).not.toBeNull()
      expect(failureNotices(resend, row.title, row.email), `${row.email}: told once`).toHaveLength(
        1,
      )
    }
  }

  const items = await invoiceItems(stripe)
  const charges = await sql<{
    digest_id: string
    batch: number
    quantity: number
    stripe_item_id: string
  }>("select digest_id, batch, quantity, stripe_item_id from charges")
  const claimed = [
    ...new Set(rows.filter((r) => r.digest_status === "sending").map((r) => r.digest_id)),
  ]

  for (const digestId of claimed) {
    const subscribers = rows.filter((row) => row.digest_id === digestId).length
    const billed = items.filter((item) => item.metadata.digest_id === digestId)

    expect(billed, `digest ${digestId}: one invoice item per batch`).toHaveLength(
      Math.ceil(subscribers / BATCH_SIZE),
    )
    expect(
      billed.reduce((sum, item) => sum + item.quantity, 0),
      `digest ${digestId}: every email billed once`,
    ).toBe(subscribers)
  }

  expect(
    charges.map((charge) => charge.stripe_item_id).toSorted(),
    "one charge row per Stripe invoice item",
  ).toEqual(items.map((item) => item.id).toSorted())
}
