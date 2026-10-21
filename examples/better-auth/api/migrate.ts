/**
 * Creates Better Auth's tables in `DATABASE_URL`, or adds what a newer Better Auth needs: the
 * same as `npx @better-auth/cli migrate`, from Harbor's own config. Run it with `npm run migrate`.
 */
import { getMigrations } from "better-auth/db/migration"

import { auth, pool } from "./auth.ts"
import { broken } from "./settings.ts"

const migrations = await getMigrations(auth.options)

await migrations.runMigrations()

const created = migrations.toBeCreated.map((table) => table.table)

console.log(created.length > 0 ? `created ${created.join(", ")}` : "the tables are up to date")

/*
 * Better Auth looks a provider's account up before it links one, but leaves the table without a
 * unique key. Harbor adds one, so a Google or GitHub account belongs to one person, once.
 */
await pool.query(
  `create unique index if not exists account_provider_account_key on account ("providerId", "accountId")`,
)

if (broken("no-unique-email")) {
  /* The safeguard this switch removes: Postgres refusing a second person with the same email. */
  const { rows } = await pool.query<{ name: string }>(
    `select conname as name from pg_constraint
      where conrelid = '"user"'::regclass and contype = 'u'`,
  )

  for (const { name } of rows) await pool.query(`alter table "user" drop constraint "${name}"`)
  console.log("BETTER_AUTH_BUG=no-unique-email: dropped the unique email constraint")
}

await pool.end()
