import { verifyToken } from "@clerk/backend"
import { isClerkAPIResponseError } from "@clerk/backend/errors"
import { afterEach, describe, expect, it } from "vitest"

import { clerkTestbed } from "./clerk-client.ts"

let bed: ReturnType<typeof clerkTestbed>

afterEach(() => bed.close())

describe("the Clerk Backend API", () => {
  it("creates, lists, counts, updates and deletes users", async () => {
    bed = clerkTestbed({ users: [{ email: "ada@danwo.test", password: "s3cret-pass", firstName: "Ada" }] })

    const grace = await bed.client.users.createUser({
      emailAddress: ["grace@danwo.test"],
      password: "another-pass",
      firstName: "Grace",
      publicMetadata: { plan: "pro" },
    })

    expect(grace.id).toMatch(/^user_[0-9A-Za-z]{27}$/)
    expect(grace.primaryEmailAddress?.emailAddress).toBe("grace@danwo.test")
    expect(grace.passwordEnabled).toBe(true)

    const all = await bed.client.users.getUserList()

    expect(all.totalCount).toBe(2)
    expect(all.data.map((u) => u.firstName)).toEqual(["Grace", "Ada"])

    const found = await bed.client.users.getUserList({ emailAddress: ["ada@danwo.test"] })

    expect(found.data.map((u) => u.firstName)).toEqual(["Ada"])

    const renamed = await bed.client.users.updateUser(grace.id, { lastName: "Hopper" })

    expect(renamed.lastName).toBe("Hopper")

    const merged = await bed.client.users.updateUserMetadata(grace.id, { publicMetadata: { seats: 3 } })

    expect(merged.publicMetadata).toEqual({ plan: "pro", seats: 3 })
    await expect(bed.client.users.verifyPassword({ userId: grace.id, password: "another-pass" })).resolves.toEqual({
      verified: true,
    })

    const deleted = await bed.client.users.deleteUser(grace.id)

    expect(deleted.deleted).toBe(true)
    await expect(bed.client.users.getUser(grace.id)).rejects.toSatisfy(
      (error: unknown) => isClerkAPIResponseError(error) && error.status === 404,
    )
  })

  it("refuses a missing or wrong secret key, and a taken email, in Clerk's error format", async () => {
    bed = clerkTestbed({ users: [{ email: "ada@danwo.test", password: "s3cret-pass" }] })

    const answer = await fetch("https://api.clerk.com/v1/users", {
      headers: { authorization: "Bearer sk_test_wrong" },
    })

    expect(answer.status).toBe(401)
    await expect(answer.json()).resolves.toMatchObject({
      errors: [{ code: "authentication_invalid" }],
      clerk_trace_id: expect.any(String),
    })

    const taken = await bed.client.users
      .createUser({ emailAddress: ["ada@danwo.test"], password: "whatever-pass" })
      .catch((error: unknown) => error)

    expect(isClerkAPIResponseError(taken) && taken.errors[0]?.code).toBe("form_identifier_exists")
  })

  it("starts, lists, verifies, mints tokens for and revokes sessions", async () => {
    bed = clerkTestbed({
      users: [{ email: "ada@danwo.test", password: "s3cret-pass" }],
      jwtTemplates: [{ name: "supabase", claims: { email: "{{user.primary_email_address}}", role: "authenticated" } }],
    })

    const [ada] = (await bed.client.users.getUserList()).data
    const session = await bed.client.sessions.createSession({ userId: ada?.id ?? "" })
    const listed = await bed.client.sessions.getSessionList({ userId: ada?.id ?? "" })

    expect(listed.data.map((s) => s.id)).toEqual([session.id])

    const token = await bed.client.sessions.getToken(session.id)
    const claims = await verifyToken(token.jwt, { secretKey: bed.secretKey })

    expect(claims).toMatchObject({ sid: session.id, sub: ada?.id, iss: "https://danwo-app.clerk.accounts.dev" })

    const templated = await bed.client.sessions.getToken(session.id, "supabase")
    const payload = JSON.parse(Buffer.from(templated.jwt.split(".")[1] ?? "", "base64url").toString())

    expect(payload).toMatchObject({ email: "ada@danwo.test", role: "authenticated", sub: ada?.id })

    const revoked = await bed.client.sessions.revokeSession(session.id)

    expect(revoked.status).toBe("revoked")
    await expect(bed.client.sessions.getToken(session.id)).rejects.toSatisfy(
      (error: unknown) => isClerkAPIResponseError(error) && error.errors[0]?.code === "session_not_active",
    )
  })

  it("keeps organizations, memberships and invitations", async () => {
    bed = clerkTestbed({
      users: [
        { email: "ada@danwo.test", password: "s3cret-pass" },
        { email: "grace@danwo.test", password: "s3cret-pass" },
      ],
    })

    const users = (await bed.client.users.getUserList()).data
    const ada = users.find((u) => u.primaryEmailAddress?.emailAddress === "ada@danwo.test")
    const grace = users.find((u) => u.primaryEmailAddress?.emailAddress === "grace@danwo.test")
    const org = await bed.client.organizations.createOrganization({ name: "Analytical Engines", createdBy: ada?.id ?? "" })

    expect(org.slug).toBe("analytical-engines")
    await bed.client.organizations.createOrganizationMembership({
      organizationId: org.id,
      userId: grace?.id ?? "",
      role: "org:member",
    })

    const members = await bed.client.organizations.getOrganizationMembershipList({ organizationId: org.id })

    expect(members.totalCount).toBe(2)
    expect(members.data.map((m) => [m.publicUserData?.identifier, m.role])).toEqual([
      ["ada@danwo.test", "org:admin"],
      ["grace@danwo.test", "org:member"],
    ])

    const invitation = await bed.client.organizations.createOrganizationInvitation({
      organizationId: org.id,
      emailAddress: "linus@danwo.test",
      role: "org:member",
    })

    expect(invitation.status).toBe("pending")

    const mine = await bed.client.users.getOrganizationMembershipList({ userId: grace?.id ?? "" })

    expect(mine.data.map((m) => m.organization.name)).toEqual(["Analytical Engines"])
  })

  it("issues sign-in tokens and serves the instance's public keys", async () => {
    bed = clerkTestbed({ users: [{ email: "ada@danwo.test", password: "s3cret-pass" }] })

    const [ada] = (await bed.client.users.getUserList()).data
    const token = await bed.client.signInTokens.createSignInToken({ userId: ada?.id ?? "", expiresInSeconds: 600 })

    expect(token.url).toMatch(/^https:\/\/danwo-app\.accounts\.dev\/sign-in\?__clerk_ticket=/)

    const jwks = await bed.client.jwks.getJwks()

    expect(jwks.keys?.[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" })
  })
})
