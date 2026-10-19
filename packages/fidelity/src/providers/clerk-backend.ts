/**
 * Clerk's Backend API scenarios: users from creation to deletion, organizations with memberships
 * and invitations, sessions and their tokens, the signing keys, and the error envelope. Every user
 * and organization a scenario makes is deleted afterwards.
 */
import type { Answer, Scenario, ScenarioContext } from "../scenario.ts"
import { asJsonObject } from "../shape.ts"
import { credential } from "../target.ts"

const API = "https://api.clerk.com/v1"

/** Values the shapes keep: the parts of Clerk's answers that are API, not data. */
export const CLERK_LITERALS = [
  "**.verification.status",
  "**.verification.strategy",
  "status",
  "role",
  "errors[].code",
  "deleted",
]

/** Metadata objects hold whatever the app put there. */
const MAPS = ["**.public_metadata", "**.private_metadata", "**.unsafe_metadata"]

/** A request to the Backend API with the target's secret key, JSON encoded as Clerk's SDKs send. */
export function backend(
  context: ScenarioContext,
  method: string,
  path: string,
  body?: unknown,
  key = credential(context.target, "key"),
): Request {
  return new Request(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
}

/** A string field of an answer's top-level object. */
export function idOf(answer: Answer, name = "id"): string {
  const value = asJsonObject(answer.body)?.[name]

  if (typeof value !== "string") throw new Error(`expected the answer to have a string ${name}`)

  return value
}

/** A test address Clerk's development instances accept without sending mail. */
export function testEmail(context: ScenarioContext, who: string): string {
  return `${who}${context.unique}+clerk_test@example.com`
}

/** Creates a user, deleted when the scenario ends. */
async function createUser(context: ScenarioContext, who: string): Promise<string> {
  const created = await context.step(
    `create user (${who})`,
    backend(context, "POST", "/users", {
      email_address: [testEmail(context, who)],
      password: `Fidelity-${context.unique}-Pw!9`,
      first_name: "Fidelity",
      last_name: "Check",
      external_id: `fidelity_${who}_${context.unique}`,
      public_metadata: { plan: "pro" },
      private_metadata: { tier: 1 },
      unsafe_metadata: { theme: "dark" },
    }),
    { literals: CLERK_LITERALS, maps: MAPS },
  )
  const id = idOf(created)

  context.cleanup(() => context.target.send(backend(context, "DELETE", `/users/${id}`)))

  return id
}

const users: Scenario = {
  name: "users: create, read, list, update, ban, delete",
  async run(context) {
    const id = await createUser(context, "user")
    const options = { literals: CLERK_LITERALS, maps: MAPS }

    await context.step("get user", backend(context, "GET", `/users/${id}`), options)
    await context.step(
      "list users by email",
      backend(
        context,
        "GET",
        `/users?email_address=${encodeURIComponent(testEmail(context, "user"))}`,
      ),
      options,
    )
    await context.step(
      "update user",
      backend(context, "PATCH", `/users/${id}`, { first_name: "Updated" }),
      options,
    )
    await context.step(
      "update metadata",
      backend(context, "PATCH", `/users/${id}/metadata`, { public_metadata: { plan: "team" } }),
      options,
    )

    const banned = await context.step(
      "ban user",
      backend(context, "POST", `/users/${id}/ban`),
      options,
    )

    context.fact("a banned user reads banned", asJsonObject(banned.body)?.["banned"] === true)
    await context.step("unban user", backend(context, "POST", `/users/${id}/unban`), options)
    await context.step("delete user", backend(context, "DELETE", `/users/${id}`), options)
  },
}

const organizations: Scenario = {
  name: "organizations: create, members, invitations, delete",
  async run(context) {
    const owner = await createUser(context, "owner")
    const member = await createUser(context, "member")
    const options = { literals: CLERK_LITERALS, maps: MAPS }
    const created = await context.step(
      "create organization",
      backend(context, "POST", "/organizations", {
        name: `Fidelity ${context.unique}`,
        created_by: owner,
      }),
      options,
    )
    const org = idOf(created)

    context.cleanup(() => context.target.send(backend(context, "DELETE", `/organizations/${org}`)))
    await context.step(
      "get organization",
      backend(context, "GET", `/organizations/${org}`),
      options,
    )
    await context.step(
      "update organization",
      backend(context, "PATCH", `/organizations/${org}`, { name: `Fidelity ${context.unique} b` }),
      options,
    )
    await context.step(
      "add member",
      backend(context, "POST", `/organizations/${org}/memberships`, {
        user_id: member,
        role: "org:member",
      }),
      options,
    )
    await context.step(
      "list memberships",
      backend(context, "GET", `/organizations/${org}/memberships`),
      options,
    )
    await context.step(
      "change member role",
      backend(context, "PATCH", `/organizations/${org}/memberships/${member}`, {
        role: "org:admin",
      }),
      options,
    )
    await context.step(
      "remove member",
      backend(context, "DELETE", `/organizations/${org}/memberships/${member}`),
      options,
    )

    const invited = await context.step(
      "invite by email",
      backend(context, "POST", `/organizations/${org}/invitations`, {
        email_address: testEmail(context, "invitee"),
        role: "org:member",
        inviter_user_id: owner,
      }),
      options,
    )

    await context.step(
      "list invitations",
      backend(context, "GET", `/organizations/${org}/invitations`),
      options,
    )
    await context.step(
      "revoke invitation",
      backend(context, "POST", `/organizations/${org}/invitations/${idOf(invited)}/revoke`, {
        requesting_user_id: owner,
      }),
      options,
    )
    await context.step(
      "delete organization",
      backend(context, "DELETE", `/organizations/${org}`),
      options,
    )
  },
}

const sessions: Scenario = {
  name: "sessions: create, list, token, revoke, and the signing keys",
  async run(context) {
    const user = await createUser(context, "session")
    const options = { literals: CLERK_LITERALS, maps: MAPS }
    const session = idOf(
      await context.step(
        "create session",
        backend(context, "POST", "/sessions", { user_id: user }),
        options,
      ),
    )

    await context.step("get session", backend(context, "GET", `/sessions/${session}`), options)
    await context.step(
      "list the user's sessions",
      backend(context, "GET", `/sessions?user_id=${user}`),
      options,
    )
    await context.step(
      "mint a session token",
      backend(context, "POST", `/sessions/${session}/tokens`, {}),
      options,
    )
    await context.step(
      "revoke session",
      backend(context, "POST", `/sessions/${session}/revoke`),
      options,
    )
    await context.step("read the signing keys", backend(context, "GET", "/jwks"), {
      literals: ["keys[].kty", "keys[].alg", "keys[].use"],
    })
  },
}

const errors: Scenario = {
  name: "errors: bad key, missing field, duplicate email, not found",
  async run(context) {
    const options = { literals: CLERK_LITERALS, maps: MAPS }

    await context.step(
      "call with a key Clerk never issued",
      backend(
        context,
        "GET",
        "/users",
        undefined,
        "REDACTED-TEST-VALUE",
      ),
      options,
    )
    await context.step(
      "create organization without a name",
      backend(context, "POST", "/organizations", {}),
      options,
    )

    await createUser(context, "taken")
    await context.step(
      "create user with a taken email",
      backend(context, "POST", "/users", { email_address: [testEmail(context, "taken")] }),
      options,
    )
    await context.step(
      "get a user that does not exist",
      backend(context, "GET", "/users/user_2danwoFidelityMissing0000"),
      options,
    )
  },
}

/** The Backend API scenarios, in the order they run. */
export const CLERK_BACKEND_SCENARIOS: readonly Scenario[] = [users, organizations, sessions, errors]
