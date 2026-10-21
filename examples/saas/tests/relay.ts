/**
 * What Relay's tests share: the people, the steps a person takes (sign up, onboard, connect
 * Slack, add a card), and the invariants. Each invariant reads one fact from two sides, Relay's
 * database and a provider's emulator, and must hold however a run went: clean, retried or faulted.
 */
import {
  type ClerkFixtures,
  clerkInstance,
  type DanwoFixtures,
  type Emulator,
  type InboxEmail,
  type ResendFixtures,
  resendInbox,
  type SlackFixtures,
  slackWorkspace,
  type StripeFixtures,
  z,
} from "@danwo/sdk"

import type { Sql } from "./db.ts"

/** Someone who signs up. */
export interface Person {
  readonly first: string
  readonly last: string
  readonly name: string
  readonly email: string
}

export const ADA: Person = {
  first: "Ada",
  last: "Lovelace",
  name: "Ada Lovelace",
  email: "ada@acme.test",
}
export const BOB: Person = { first: "Bob", last: "Kahn", name: "Bob Kahn", email: "bob@acme.test" }

/** The workspace Ada makes. */
export const WORKSPACE = "Acme"

/** What every Relay test receives: the emulators, and SQL on this worker's database. */
export type RelayFixtures = ClerkFixtures &
  StripeFixtures &
  SlackFixtures &
  ResendFixtures & { readonly sql: Sql; readonly settle: () => Promise<void> }

type Steps = Pick<DanwoFixtures, "app" | "screen" | "expect" | "mail">

/** Signs `person` up with Clerk's form and the code Clerk emails them. */
export async function signUp({ app, screen, expect, mail }: Steps, person: Person): Promise<void> {
  await app.open("/sign-up")
  await screen.getByLabel("Email address").fill(person.email)
  await screen.getByRole("button", { name: "Continue", exact: true }).click()
  await screen.getByLabel("Enter verification code").fill(await mail.code(person.email))
  await expect(screen.getByRole("heading", { name: /Set up your workspace|^Join / })).toBeVisible()
}

/** Signs `person` back in, with an emailed code: after a fortnight away their session has expired. */
export async function signIn(
  { app, screen, expect, mail }: Steps,
  person: Person,
  path = "/",
): Promise<void> {
  await app.open("/sign-in")
  await screen.getByLabel("Email address").fill(person.email)
  await screen.getByRole("button", { name: "Continue", exact: true }).click()
  await screen.getByLabel("Enter verification code").fill(await mail.code(person.email))
  await expect(screen.getByRole("navigation", { name: "Workspace" })).toBeVisible()
  if (path !== "/") await app.open(path)
}

/**
 * Names and creates the workspace on the onboarding page, as `person` (Ada unless given), and waits
 * for its trial to show.
 */
export async function onboard(
  { screen, expect }: Steps,
  name: string,
  person: Person = ADA,
): Promise<void> {
  await screen.getByLabel("Your name").fill(person.name)
  await screen.getByLabel("Workspace name").fill(name)
  await screen.getByRole("button", { name: "Create workspace" }).click()
  await expect(screen.getByRole("status").filter({ hasText: `${name} is ready` })).toBeVisible()
  await expect(screen.getByTestId("trial-banner")).toContainText("Trial: 14 days left")
}

/** Opens a section of the current workspace from the sidebar. */
export async function openSection(
  { screen, expect }: Steps,
  section: "Notes" | "Integrations" | "Settings",
): Promise<void> {
  await screen
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: section })
    .click()
  await expect(screen.getByRole("heading", { level: 1, name: section })).toBeVisible()
}

/** Connects Slack through its consent page and sends published notes to `channel`. */
export async function connectSlack(steps: Steps, channel: string): Promise<void> {
  const { screen, expect } = steps

  await openSection(steps, "Integrations")
  await screen.getByRole("button", { name: "Connect Slack" }).click()
  await screen.getByRole("button", { name: `Continue as ${ADA.name}` }).click()
  await expect(screen.getByRole("status").filter({ hasText: "Slack is connected" })).toBeVisible()
  await screen.getByLabel("Post published notes to").selectOption(`#${channel}`)
  await screen.getByRole("button", { name: "Save channel" }).click()
  await expect(screen.getByText("Published notes now go to the channel.")).toBeVisible()
}

/** Writes a note on the notes page, published unless `draft`. */
export async function writeNote(
  { screen, expect }: Steps,
  note: { readonly title: string; readonly body: string; readonly draft?: boolean },
): Promise<void> {
  await screen.getByLabel("Title").fill(note.title)
  await screen.getByLabel("Note", { exact: true }).fill(note.body)
  if (note.draft) await screen.getByLabel("Publish to the team now").uncheck()
  await screen.getByRole("button", { name: "Save note" }).click()
  await expect(
    screen.getByRole("article", { name: note.title }).getByText(note.draft ? "Draft" : "Published"),
  ).toBeVisible()
}

/** Adds a card on Stripe's own page (setup-mode Checkout), back to billing with it saved. */
export async function addCard(
  { screen, expect }: Steps,
  card = "4242 4242 4242 4242",
): Promise<void> {
  await screen.getByRole("button", { name: /^(Add|Update) the card$|^Add a card$/ }).click()
  await screen.getByLabel("Card number").fill(card)
  await screen.getByTestId("checkout-pay").click()
  await expect(screen.getByRole("status").filter({ hasText: "Your card is saved." })).toBeVisible()
}

const List = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) })
const Customer = z.object({ id: z.string(), metadata: z.record(z.string(), z.string()) })
const Subscription = z.object({
  id: z.string(),
  status: z.string(),
  customer: z.string(),
  metadata: z.record(z.string(), z.string()),
})

/** One page of a Stripe list, read from the emulator as Relay's own client would. */
async function stripeList(stripe: Emulator, path: string): Promise<unknown> {
  const res = await stripe.fetch(
    new Request(`https://api.stripe.com/v1/${path}`, {
      headers: { authorization: "Bearer sk_test_relay_notes" },
    }),
  )

  return res.json()
}

const Organization = z.object({
  id: z.string(),
  private_metadata: z.record(z.string(), z.unknown()),
})
/** A Clerk Backend API read, from the emulator, as Relay's server makes it. */
async function clerkApi(clerk: Emulator, path: string): Promise<unknown> {
  const res = await clerk.fetch(
    new Request(`https://api.clerk.com/v1/${path}`, {
      headers: { authorization: `Bearer ${clerkInstance(clerk).instance.secretKey}` },
    }),
  )

  return res.json()
}

/** Clerk's organizations, with the private metadata that ties each to a workspace. */
export async function clerkOrganizations(clerk: Emulator) {
  return List(Organization).parse(await clerkApi(clerk, "organizations?limit=100")).data
}

/** The email addresses and roles of a Clerk organization's members. */
export function clerkMembers(clerk: Emulator, orgId: string) {
  const instance = clerkInstance(clerk)
  const users = instance.users()

  return instance.memberships(orgId).map((member) => ({
    email: users.find((user) => user.id === member.user_id)?.email_addresses[0]?.email_address,
    role: member.role,
  }))
}

interface WorkspaceRow {
  readonly id: string
  readonly clerk_org_id: string | null
  readonly stripe_customer_id: string | null
  readonly stripe_subscription_id: string | null
  readonly subscription_status: string | null
  readonly ready_at: Date | null
}

/** Relay's workspaces. */
export function workspacesOf(sql: Sql): Promise<WorkspaceRow[]> {
  return sql<WorkspaceRow>(
    "select id, clerk_org_id, stripe_customer_id, stripe_subscription_id, subscription_status, ready_at from workspaces order by created_at",
  )
}

/** The emails Resend accepted, waiting up to a while for at least `atLeast` matching `filter`. */
async function emailsWhere(
  resend: Emulator,
  filter: (email: InboxEmail) => boolean,
  atLeast: number,
): Promise<InboxEmail[]> {
  const deadline = Date.now() + 20_000
  const matching = () => resendInbox(resend).list().filter(filter)

  while (matching().length < atLeast && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 200))

  return matching()
}

type Check = RelayFixtures & Pick<DanwoFixtures, "expect">

/**
 * Onboarding made exactly one of everything: each workspace has one Clerk organization (tied to it
 * by its private metadata), one Stripe customer and one live subscription, and nothing on Clerk's
 * or Stripe's side belongs to no workspace or to two.
 */
export async function expectOnboardedOnce({ sql, clerk, stripe, expect }: Check): Promise<void> {
  const workspaces = await workspacesOf(sql)
  const orgs = await clerkOrganizations(clerk)
  /* Relay's own: the emulator starts with a customer of its own, which carries no workspace. */
  const customers = List(Customer)
    .parse(await stripeList(stripe, "customers?limit=100"))
    .data.filter((customer) => customer.metadata.workspace_id !== undefined)
  const subscriptions = List(Subscription).parse(
    await stripeList(stripe, "subscriptions?limit=100&status=all"),
  ).data
  const live = subscriptions.filter(
    (one) => one.status !== "canceled" && one.status !== "incomplete_expired",
  )
  const ids = workspaces.map((workspace) => workspace.id).toSorted()

  expect(
    orgs.map((org) => String(org.private_metadata.workspace_id)).toSorted(),
    "one Clerk organization per workspace",
  ).toEqual(
    workspaces
      .filter((one) => one.clerk_org_id)
      .map((one) => one.id)
      .toSorted(),
  )
  expect(
    customers.map((customer) => customer.metadata.workspace_id).toSorted(),
    "one Stripe customer per workspace",
  ).toEqual(
    workspaces
      .filter((one) => one.stripe_customer_id)
      .map((one) => one.id)
      .toSorted(),
  )
  expect(
    live.map((subscription) => subscription.metadata.workspace_id).toSorted(),
    "one live subscription per workspace",
  ).toEqual(
    workspaces
      .filter((one) => one.stripe_subscription_id)
      .map((one) => one.id)
      .toSorted(),
  )

  for (const workspace of workspaces.filter((one) => one.ready_at)) {
    expect(workspace.clerk_org_id, "a ready workspace has its organization").toBe(
      orgs.find((org) => org.private_metadata.workspace_id === workspace.id)?.id,
    )
    expect(workspace.stripe_subscription_id, "a ready workspace has its subscription").toBe(
      live.find((one) => one.metadata.workspace_id === workspace.id)?.id,
    )
  }

  expect(new Set(ids).size, "no workspace twice").toBe(ids.length)
}

/** Each workspace's subscription status is what Stripe says it is now. */
export async function expectStatusMatchesStripe({
  sql,
  stripe,
  expect,
  settle,
}: Check): Promise<void> {
  await settle()

  const subscriptions = List(Subscription).parse(
    await stripeList(stripe, "subscriptions?limit=100&status=all"),
  ).data

  for (const workspace of await workspacesOf(sql))
    if (workspace.stripe_subscription_id)
      expect(workspace.subscription_status, `${workspace.id}: the status Stripe has`).toBe(
        subscriptions.find((one) => one.id === workspace.stripe_subscription_id)?.status,
      )
}

/** Every person got exactly one welcome email, and every ready workspace one getting-started email. */
export async function expectWelcomedOnce({ sql, resend, expect }: Check): Promise<void> {
  const users = await sql<{ email: string }>("select email from users")
  const ready = await sql<{ name: string; email: string }>(
    "select w.name, u.email from workspaces w join users u on u.id = w.owner_id where w.ready_at is not null",
  )
  const welcomes = await emailsWhere(
    resend,
    (email) => email.subject === "Welcome to Relay",
    users.length,
  )
  const started = await emailsWhere(
    resend,
    (email) => email.subject.endsWith("your trial has started"),
    ready.length,
  )

  for (const user of users)
    expect(
      welcomes.filter((email) => email.to.includes(user.email)),
      `one welcome email to ${user.email}`,
    ).toHaveLength(1)
  expect(welcomes, "no welcome email to anyone else").toHaveLength(users.length)
  for (const workspace of ready)
    expect(
      started.filter((email) => email.subject.startsWith(`${workspace.name} is ready`)),
      `one getting-started email for ${workspace.name}`,
    ).toHaveLength(1)
}

/**
 * Every published note is in its workspace's Slack channel exactly once, and no draft is. A note
 * can be missing only when Slack stopped accepting Relay's token and the integration says so.
 */
export async function expectPostedOnce({ sql, slack, expect, settle }: Check): Promise<void> {
  await settle()

  const notes = await sql<{ id: number; workspace_id: string; published: boolean }>(
    "select id, workspace_id, published_at is not null as published from notes",
  )
  const connections = await sql<{
    workspace_id: string
    status: string
    channel_name: string | null
  }>("select workspace_id, status, channel_name from integrations where provider = 'slack'")
  const workspace = slackWorkspace(slack)

  for (const note of notes) {
    const connection = connections.find((one) => one.workspace_id === note.workspace_id)

    if (!connection?.channel_name) continue

    const link = `/w/${note.workspace_id}/notes/${note.id}|`
    const posts = workspace
      .messages(`#${connection.channel_name}`)
      .filter((message) => message.text.includes(link))

    if (!note.published) expect(posts, `draft ${note.id} is not in Slack`).toHaveLength(0)
    else if (connection.status === "needs_attention")
      expect(posts.length, `note ${note.id} is in Slack at most once`).toBeLessThanOrEqual(1)
    else expect(posts, `note ${note.id} is in Slack exactly once`).toHaveLength(1)
  }
}

/** Every billing email went out once per invoice: one receipt per paid invoice, at most. */
export async function expectBilledOnce({ resend, expect }: Check): Promise<void> {
  const subjects = resendInbox(resend)
    .list()
    .map((email) => `${email.subject} ${email.text ?? ""}`)
  const invoices = subjects.flatMap((text) => /Invoice (in_\w+) is paid/.exec(text)?.[1] ?? [])

  expect(invoices, "one receipt per paid invoice").toEqual([...new Set(invoices)])
}

/** All of Relay's invariants, for a test that touches everything. */
export async function expectRelayConsistent(fixtures: Check): Promise<void> {
  await expectOnboardedOnce(fixtures)
  await expectStatusMatchesStripe(fixtures)
  await expectWelcomedOnce(fixtures)
  await expectPostedOnce(fixtures)
  await expectBilledOnce(fixtures)
}
