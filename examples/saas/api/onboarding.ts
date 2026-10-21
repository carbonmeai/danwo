/**
 * Onboarding: one form makes a workspace, its Clerk organization, its Stripe customer and a
 * trialing subscription. Any of those calls can fail halfway, or succeed with its answer lost, so
 * each step is safe to run again and records what it made before the next starts:
 *
 * - the workspace row is keyed by the form's onboarding key, so a double submit makes one;
 * - the organization's slug is the workspace's id, so a retry that finds the slug taken adopts the
 *   organization the lost attempt made instead of making another;
 * - the customer and the subscription are created with idempotency keys named after the
 *   workspace, so Stripe answers a retry with what it made the first time.
 *
 * A failed onboarding leaves the workspace half made; submitting the form again finishes it.
 */
import { and, eq, isNull } from "drizzle-orm"

import { broken } from "../shared/bugs.ts"
import { query, transaction } from "../shared/db/client.ts"
import { members, users, workspaces } from "../shared/db/schema.ts"
import { workspaceReady } from "../shared/events.ts"
import { enqueue, flushSoon } from "../shared/outbox.ts"
import { TRIAL_DAYS, TRIAL_PLAN } from "../shared/plans.ts"
import { clerk, clerkCall, clerkCode } from "./clerk.ts"
import { ensureUser, type Person } from "./people.ts"
import { HttpError } from "./problems.ts"
import { stripe, stripeCall, idempotent } from "./stripe.ts"
import { mirrorOf, priceOf } from "./subscriptions.ts"

type Workspace = typeof workspaces.$inferSelect

/** The organization's slug: the workspace's own id, which no other workspace can have. */
function slugOf(workspace: Workspace): string {
  return `relay-${workspace.id}`
}

/** The workspace for an onboarding key, made now unless an earlier submit made it. */
async function startWorkspace(owner: Person, name: string, key: string): Promise<Workspace> {
  return transaction("start workspace", async (tx) => {
    const [made] = await tx
      .insert(workspaces)
      .values({ onboardingKey: key, name, ownerId: owner.id, plan: TRIAL_PLAN })
      .onConflictDoNothing({ target: workspaces.onboardingKey })
      .returning()
    const workspace =
      made ?? (await tx.select().from(workspaces).where(eq(workspaces.onboardingKey, key)))[0]

    if (!workspace || workspace.ownerId !== owner.id)
      throw new HttpError(409, "That form was already used. Reload the page and try again.")

    await tx
      .insert(members)
      .values({ workspaceId: workspace.id, userId: owner.id, role: "org:admin" })
      .onConflictDoNothing()

    return workspace
  })
}

/**
 * The workspace's Clerk organization: made, or, when an earlier attempt made it and its answer was
 * lost, found by its slug. With SAAS_BUG=no-onboarding-retry Clerk picks the slug from the name,
 * so nothing ties a lost attempt's organization to the workspace.
 */
async function organizationOf(workspace: Workspace, owner: Person): Promise<string> {
  const slug = broken("no-onboarding-retry") ? undefined : slugOf(workspace)

  try {
    const org = await clerkCall("create organization", () =>
      clerk.organizations.createOrganization({
        name: workspace.name,
        ...(slug !== undefined && { slug }),
        createdBy: owner.id,
        privateMetadata: { workspace_id: workspace.id },
      }),
    )

    return org.id
  } catch (error) {
    if (slug === undefined || clerkCode(error) !== "form_identifier_exists") throw error

    const org = await clerkCall("find organization", () =>
      clerk.organizations.getOrganization({ slug }),
    )

    if (org.privateMetadata.workspace_id !== workspace.id) throw error

    return org.id
  }
}

/** Saves one outside id on the workspace, unless a concurrent attempt saved one first. */
async function record(workspace: Workspace, fields: Partial<Workspace>): Promise<Workspace> {
  const [saved] = await query("record onboarding step", (db) =>
    db.update(workspaces).set(fields).where(eq(workspaces.id, workspace.id)).returning(),
  )

  return saved ?? workspace
}

/** The customer, made with an idempotency key so a retry gets the same one back. */
async function customerOf(workspace: Workspace, owner: Person): Promise<string> {
  const customer = await stripeCall("create customer", () =>
    stripe.customers.create(
      { name: workspace.name, email: owner.email, metadata: { workspace_id: workspace.id } },
      idempotent(`workspace-${workspace.id}-customer`),
    ),
  )

  return customer.id
}

/** The trial: the Team plan for fourteen days, with no card needed yet. */
async function startTrial(workspace: Workspace, customer: string) {
  return stripeCall("create subscription", () =>
    stripe.subscriptions.create(
      {
        customer,
        items: [{ price: priceOf(TRIAL_PLAN) }],
        trial_period_days: TRIAL_DAYS,
        payment_settings: { save_default_payment_method: "on_subscription" },
        metadata: { workspace_id: workspace.id },
      },
      idempotent(`workspace-${workspace.id}-subscription`),
    ),
  )
}

/** Marks the workspace ready and queues its getting-started email, once. */
async function finish(workspace: Workspace): Promise<void> {
  await transaction("finish onboarding", async (tx) => {
    const [ready] = await tx
      .update(workspaces)
      .set({ readyAt: new Date() })
      .where(and(eq(workspaces.id, workspace.id), isNull(workspaces.readyAt)))
      .returning({ id: workspaces.id })

    if (ready)
      await enqueue(tx, {
        id: `ready-${workspace.id}`,
        name: workspaceReady.name,
        data: { workspaceId: workspace.id },
      })
  })
  await flushSoon()
}

/**
 * Saves the name the person gave on Clerk and on Relay's copy. Setting a name twice is the same as
 * setting it once, so this needs no key of its own.
 */
async function nameUser(owner: Person, name: string): Promise<Person> {
  if (owner.name === name) return owner

  const [first = name, ...rest] = name.split(" ")

  await clerkCall("name user", () =>
    clerk.users.updateUser(owner.id, { firstName: first, lastName: rest.join(" ") }),
  )
  await query("name user", (db) => db.update(users).set({ name }).where(eq(users.id, owner.id)))

  return { ...owner, name }
}

/**
 * Runs (or finishes) the onboarding the form with `key` asked for; the workspace's id. Throws when
 * a step still fails after its retries; the form can be sent again to carry on.
 */
export async function onboard(
  userId: string,
  form: { readonly name: string; readonly workspace: string; readonly key: string },
): Promise<string> {
  const owner = await nameUser(await ensureUser(userId), form.name)
  let workspace = await startWorkspace(owner, form.workspace, form.key)

  if (workspace.readyAt) return workspace.id

  if (!workspace.clerkOrgId)
    workspace = await record(workspace, { clerkOrgId: await organizationOf(workspace, owner) })
  if (!workspace.stripeCustomerId)
    workspace = await record(workspace, {
      stripeCustomerId: await customerOf(workspace, owner),
    })
  if (!workspace.stripeSubscriptionId && workspace.stripeCustomerId)
    workspace = await record(
      workspace,
      mirrorOf(await startTrial(workspace, workspace.stripeCustomerId)),
    )

  await finish(workspace)

  return workspace.id
}
