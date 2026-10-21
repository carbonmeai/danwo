"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { createOrganization, inviteMember, organizationsOf } from "../../../lib/organizations.ts"

/** What a form shows after it was sent: a confirmation, or what went wrong. */
export interface FormState {
  readonly message?: string
  readonly error?: string
}

/** A forgiving email check, as the browser's own `type="email"` makes. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The error's message for the form, or a general one. */
function problem(error: unknown): string {
  return error instanceof Error && error.message.startsWith("An organization called")
    ? error.message
    : "Clerk could not be reached. Try again in a moment."
}

/** Creates an organization run by the signed-in person, then opens it. */
export async function createOrganizationAction(
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const { userId } = await auth.protect()
  const name = String(form.get("name") ?? "").trim()

  if (name === "") return { error: "Give the organization a name." }

  let id: string

  try {
    id = await createOrganization(userId, name)
  } catch (error) {
    return { error: problem(error) }
  }

  redirect(`/organization?org=${id}`)
}

/** Invites someone by email to an organization the signed-in person runs. */
export async function inviteAction(_previous: FormState, form: FormData): Promise<FormState> {
  const { userId } = await auth.protect()
  const orgId = String(form.get("organization") ?? "")
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase()

  if (!EMAIL.test(email)) return { error: "Enter a valid email address." }

  try {
    const admin = (await organizationsOf(userId)).some(
      (org) => org.id === orgId && org.role === "org:admin",
    )

    if (!admin) return { error: "Only an admin can invite people." }

    /* The invitation's link brings them to this app's sign-up, wherever it runs. */
    const request = await headers()
    const origin = `${request.get("x-forwarded-proto") ?? "http"}://${request.get("host") ?? ""}`
    const outcome = await inviteMember(orgId, userId, email, `${origin}/sign-up`)

    revalidatePath("/organization")

    if (outcome === "member") return { message: `${email} is already a member.` }
    if (outcome === "already-invited") return { message: `${email} is already invited.` }

    return { message: `Invitation sent to ${email}.` }
  } catch (error) {
    return { error: problem(error) }
  }
}
