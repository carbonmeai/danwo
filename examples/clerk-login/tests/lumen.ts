/**
 * What Lumen's tests share: who is seeded where, signing in the way a person does, and the
 * invariants. Each invariant reads one fact from two sides, Clerk's emulator and the app's own
 * database, and must hold however a run went: clean, retried or faulted.
 */
import {
  type App,
  type ClerkFixtures,
  clerkInstance,
  type DanwoFixtures,
  type Emulator,
  type Screen,
  type SessionMail,
  stableClerkId,
  test as base,
  z,
} from "@danwo/sdk"

import { sql } from "./db.ts"
import type { SeedRow } from "./stack/postgres.ts"

/** Ada, who has an account from the start, and runs an organization. */
export const ADA = { email: "ada@lumen.test", firstName: "Ada", lastName: "Lovelace" } as const

/** Ada's organization, seeded in Clerk and, with the same ids, in the app's database. */
export const ADAS_ORG = { name: "Analytical Engines", slug: "analytical-engines" } as const

/** Lin, who has a Google account but has never been to Lumen. */
export const LIN = { email: "lin@lumen.test", name: "Lin Wu" } as const

/** The OAuth client Lumen's Clerk instance signs in to Google with. */
export const GOOGLE_CLIENT = {
  client_id: "lumen-clerk.apps.googleusercontent.com",
  client_secret: "lumen-clerk-google-secret",
} as const

/** Ada's Clerk ids, the same on every run: her user, her organization and her membership. */
export const ADA_IDS = {
  user: stableClerkId("user", ADA.email),
  org: stableClerkId("org", ADAS_ORG.slug),
  membership: stableClerkId("orgmem", `${ADAS_ORG.slug}:${ADA.email}`),
} as const

/** The app's rows for what Clerk is seeded with, put back after every reset. */
export const SEED_ROWS: readonly SeedRow[] = [
  {
    text: `insert into app_users (clerk_user_id, email, first_name, last_name, clerk_updated_at)
           values ($1, $2, $3, $4, 0)`,
    values: [ADA_IDS.user, ADA.email, ADA.firstName, ADA.lastName],
  },
  {
    text: `insert into memberships (clerk_membership_id, clerk_org_id, org_name, clerk_user_id, role, clerk_updated_at)
           values ($1, $2, $3, $4, 'org:admin', 0)`,
    values: [ADA_IDS.membership, ADA_IDS.org, ADAS_ORG.name, ADA_IDS.user],
  },
]

/** The worker's own database, which `danwo.config.ts` hands every test. */
interface LumenFixtures {
  readonly databaseUrl: string
}

export type Fixtures = ClerkFixtures & LumenFixtures

export const test = base.extend<Fixtures>()

/** One person's browser: the test's own, or a second person's from `users.open`. */
export interface Person {
  readonly app: App
  readonly screen: Screen
  readonly mail: SessionMail
  readonly expect: DanwoFixtures["expect"]
}

/** Signs `email` in on Clerk's `<SignIn/>` with the code Clerk emails, and waits for the dashboard. */
export async function signIn({ app, screen, mail, expect }: Person, email: string): Promise<void> {
  await app.open("/sign-in")
  await screen.getByLabel("Email address").fill(email)
  await screen.getByRole("button", { name: "Continue", exact: true }).click()
  await screen.getByLabel("Enter verification code").fill(await mail.code(email))
  await expect(screen.getByRole("heading", { name: /^Welcome, / })).toBeVisible()
}

/** What an invariant reads: the fixtures, and `expect`. */
type Judged = Fixtures & { readonly expect: DanwoFixtures["expect"] }

interface UserRow {
  readonly clerk_user_id: string
  readonly email: string
}

/** Every Clerk user's email, by id, read from the emulator. */
function clerkUsers(clerk: Emulator): Map<string, string> {
  const view = clerkInstance(clerk)

  return new Map(
    view.users().map((user) => [user.id, user.email_addresses[0]?.email_address ?? ""]),
  )
}

/**
 * Exactly one app user per Clerk user, with Clerk's email address, and none Clerk doesn't have:
 * however often `user.created` arrived, and whether it came before or after the redirect.
 */
export async function oneAppUserPerClerkUser({
  clerk,
  databaseUrl,
  expect,
}: Judged): Promise<void> {
  const rows = await sql<UserRow>(databaseUrl, "select clerk_user_id, email from app_users")
  const users = clerkUsers(clerk)

  expect(rows.map((row) => row.clerk_user_id).toSorted(), "one app user per Clerk user").toEqual(
    [...users.keys()].toSorted(),
  )

  for (const row of rows)
    expect(row.email, `${row.clerk_user_id}'s email`).toBe(users.get(row.clerk_user_id))
}

interface MembershipRow {
  readonly clerk_org_id: string
  readonly clerk_user_id: string
  readonly role: string
}

/** Every membership Clerk has, the app has too, with the same role; and no others. */
export async function membershipsAgree({ clerk, databaseUrl, expect }: Judged): Promise<void> {
  const rows = await sql<MembershipRow>(
    databaseUrl,
    "select clerk_org_id, clerk_user_id, role from memberships",
  )
  const key = (m: MembershipRow) => `${m.clerk_org_id} ${m.clerk_user_id} ${m.role}`
  const inClerk = clerkInstance(clerk)
    .memberships()
    .map((m) => key({ clerk_org_id: m.organization_id, clerk_user_id: m.user_id, role: m.role }))

  expect(rows.map(key).toSorted(), "the app's memberships are Clerk's").toEqual(inClerk.toSorted())
}

/**
 * Every webhook Clerk didn't sign was refused: the copies `danwo matrix` signs with the wrong
 * secret, and the ones it replays with an hour-old signature, all answered 4xx.
 */
export function refusedUnsignedWebhooks({ clerk, expect }: Judged): void {
  const taken = (clerk.webhooks?.attempts() ?? []).filter(
    (attempt) =>
      (attempt.fault === "forged" || attempt.fault?.startsWith("stale") === true) &&
      attempt.status !== null &&
      attempt.status < 300,
  )

  expect(
    taken.map((attempt) => `${attempt.fault} ${attempt.topic}`),
    "webhooks Clerk didn't sign were refused",
  ).toEqual([])
}

const Invitations = z.object({
  data: z.array(z.object({ email_address: z.string(), status: z.string() })),
})

/** An organization's invitations, read from Clerk's Backend API the way the app's server would. */
async function invitationsOf(
  clerk: Emulator,
  orgId: string,
): Promise<z.infer<typeof Invitations>["data"]> {
  const response = await clerk.fetch(
    new Request(`https://api.clerk.com/v1/organizations/${orgId}/invitations?limit=100`, {
      headers: { authorization: `Bearer ${clerkInstance(clerk).instance.secretKey}` },
    }),
  )

  return Invitations.parse(await response.json()).data
}

/**
 * However far the invitation got: at most one `organization`; at most one invitation sent to
 * `invitee`; and once they have an account, they are a member exactly once, with no invitation
 * still pending. A retry after a lost answer, or the form sent twice, never invites twice.
 */
export async function invitedOnce(
  { clerk, expect }: Judged,
  { organization, invitee }: { readonly organization: string; readonly invitee: string },
): Promise<void> {
  const view = clerkInstance(clerk)
  const orgs = view.organizations().filter((o) => o.name === organization)

  expect(orgs.length, `at most one ${organization}`).toBeLessThanOrEqual(1)

  const org = orgs[0]

  if (org === undefined) return

  const sent = (await invitationsOf(clerk, org.id)).filter(
    (invitation) => invitation.email_address === invitee,
  )

  expect(sent.length, `at most one invitation to ${invitee}`).toBeLessThanOrEqual(1)

  const user = view.user(invitee)

  if (user === undefined) return

  expect(
    view
      .memberships(org.id)
      .filter((m) => m.user_id === user.id)
      .map((m) => m.role),
    `${invitee} is a member once`,
  ).toEqual(["org:member"])
  expect(
    sent.map((invitation) => invitation.status),
    "the invitation was used",
  ).toEqual(["accepted"])
}

/** Every account invariant at once: users and memberships agree, unsigned webhooks refused. */
export async function accountsAgree(fixtures: Judged): Promise<void> {
  refusedUnsignedWebhooks(fixtures)
  await oneAppUserPerClerkUser(fixtures)
  await membershipsAgree(fixtures)
}
