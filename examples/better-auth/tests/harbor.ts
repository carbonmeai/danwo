/**
 * What Harbor's tests share: who is seeded where, signing in the way a person does, and the
 * invariants. Each invariant reads Harbor's own database (Better Auth's tables) and, where email
 * is involved, the Resend emulator too, and must hold however a run went: clean, retried or
 * faulted.
 */
import {
  type App,
  type DanwoFixtures,
  type GithubFixtures,
  type GoogleFixtures,
  type ResendFixtures,
  resendInbox,
  type Screen,
  type SessionMail,
  test as base,
} from "@danwo/sdk"

import { sql } from "./db.ts"
import type { SeedRow } from "./stack/postgres.ts"

/** Ada has a Harbor account from the start, a Google account at the same address, and GitHub. */
export const ADA = {
  id: "user_ada",
  email: "ada@harbor.test",
  name: "Ada Lovelace",
  github: "ada-lovelace",
  /** Her GitHub account's address differs from her Harbor one. */
  githubEmail: "ada@analytical.engines",
} as const

/** Lin has a Google account but has never been to Harbor. */
export const LIN = { email: "lin@harbor.test", name: "Lin Wu" } as const

/** Kai has a GitHub account but has never been to Harbor. */
export const KAI = { email: "kai@harbor.test", name: "Kai Moreno", github: "kai-moreno" } as const

/** The OAuth clients Harbor signs in with: Google's, and a GitHub OAuth App. */
export const GOOGLE_CLIENT = {
  client_id: "harbor.apps.googleusercontent.com",
  client_secret: "harbor-google-secret",
} as const

export const GITHUB_CLIENT = {
  clientId: "Iv1.harbor0000000000",
  clientSecret: "harbor-github-secret",
} as const

/** The rows every test starts from: Ada's account, her address already confirmed. */
export const SEED_ROWS: readonly SeedRow[] = [
  {
    text: `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
           values ($1, $2, $3, true, now(), now())`,
    values: [ADA.id, ADA.name, ADA.email],
  },
]

/** The sign-in code's subject; the app's `api/mail.ts` sends it. */
export const CODE_SUBJECT = "Your Harbor sign-in code"

/** The worker's own database, which `danwo.config.ts` hands every test. */
interface HarborFixtures {
  readonly databaseUrl: string
}

export type Fixtures = ResendFixtures & GoogleFixtures & GithubFixtures & HarborFixtures

export const test = base.extend<Fixtures>()

/** One person's browser: the test's own, or a second one from `users.open`. */
export interface Person {
  readonly app: App
  readonly screen: Screen
  readonly mail: SessionMail
  readonly expect: DanwoFixtures["expect"]
}

/** Asks Harbor to email `email` a code, and waits for the page that asks for it. */
export async function askForCode({ app, screen, expect }: Person, email: string): Promise<void> {
  await app.open("/sign-in")
  await screen.getByLabel("Email address").fill(email)
  await screen.getByRole("button", { name: "Email me a code" }).click()
  await expect(screen.getByRole("heading", { name: "Check your email" })).toBeVisible()
}

/** Signs `email` in with the code Harbor emails, and waits for the dashboard. */
export async function signIn(person: Person, email: string): Promise<void> {
  const { screen, mail, expect } = person

  await askForCode(person, email)
  await screen.getByLabel("Code").fill(await mail.code(email))
  await screen.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(screen.getByRole("heading", { name: /^Welcome, / })).toBeVisible()
}

/** What an invariant reads: the fixtures, and `expect`. */
export type Judged = Fixtures & { readonly expect: DanwoFixtures["expect"] }

/** Harbor's user rows, by email. */
export async function users(databaseUrl: string): Promise<{ id: string; email: string }[]> {
  return sql(databaseUrl, `select id, email from "user" order by email, id`)
}

/** Who has which accounts linked: `email provider` pairs, sorted. */
export async function links(databaseUrl: string): Promise<string[]> {
  const rows = await sql<{ email: string; providerId: string }>(
    databaseUrl,
    `select u.email, a."providerId" from account a join "user" u on u.id = a."userId"`,
  )

  return rows.map((row) => `${row.email} ${row.providerId}`).toSorted()
}

/** The live sessions of the person at `email`, oldest first. */
export async function sessionsOf(
  databaseUrl: string,
  email: string,
): Promise<{ id: string; token: string; userAgent: string | null }[]> {
  return sql(
    databaseUrl,
    `select s.id, s.token, s."userAgent" from session s join "user" u on u.id = s."userId"
      where u.email = $1 order by s."createdAt"`,
    [email],
  )
}

/** One user row per person, however they signed in: no email belongs to two rows. */
export async function onePersonOneUser({ databaseUrl, expect }: Judged): Promise<void> {
  const shared = await sql<{ email: string; rows: string }>(
    databaseUrl,
    `select lower(email) as email, count(*) as rows from "user" group by 1 having count(*) > 1`,
  )

  expect(shared, "one user row per person").toEqual([])
}

/**
 * One account row per provider link: a Google or GitHub account belongs to one person, once, and
 * nobody has two of the same provider.
 */
export async function oneAccountPerLink({ databaseUrl, expect }: Judged): Promise<void> {
  const twice = await sql(
    databaseUrl,
    `select "providerId", "accountId", count(*) as rows from account
      group by 1, 2 having count(*) > 1
     union all
     select "providerId", "userId", count(*) from account
      group by 1, 2 having count(*) > 1`,
  )

  expect(twice, "one account row per provider link").toEqual([])
}

/**
 * Exactly one email per code: a retry after Resend lost its answer, or a request sent twice, never
 * mails the same code twice. And the newest code email to anyone holds the code that works now,
 * if one does, so the email a person opens is never a dead one.
 */
export async function oneEmailPerCode({ databaseUrl, resend, expect }: Judged): Promise<void> {
  const codes = resendInbox(resend)
    .list()
    .filter((email) => email.subject === CODE_SUBJECT)
  const sent = codes.map((email) => `${email.to.join(",")} ${email.code() ?? "?"}`)

  expect(sent, "exactly one email per code").toEqual([...new Set(sent)])

  /* Better Auth checks a code against the newest row for the address; older ones are dead. */
  const live = await sql<{ identifier: string; value: string }>(
    databaseUrl,
    `select distinct on (identifier) identifier, value from verification
      where identifier like 'sign-in-otp-%' order by identifier, "createdAt" desc`,
  )

  for (const row of live) {
    const email = row.identifier.slice("sign-in-otp-".length)
    const code = row.value.slice(0, row.value.lastIndexOf(":"))
    const newest = codes.find((sent) => sent.to.includes(email))

    /* No email yet is a send still on its way (a slow Resend): nobody holds a dead code. */
    if (newest !== undefined)
      expect(newest.code(), `the newest email to ${email} holds the code that works`).toBe(code)
  }
}

/** Every invariant about people and their accounts at once. */
export async function accountsHold(fixtures: Judged): Promise<void> {
  await onePersonOneUser(fixtures)
  await oneAccountPerLink(fixtures)
  await oneEmailPerCode(fixtures)
}
