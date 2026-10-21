"use client"

import { useActionState } from "react"

import { createOrganizationAction, type FormState, inviteAction } from "./actions.ts"

const NOTHING_YET: FormState = {}

/** What the last submit came to, under the form. */
function Outcome({ state }: { readonly state: FormState }) {
  if (state.error !== undefined)
    return (
      <p role="alert" className="error">
        {state.error}
      </p>
    )
  if (state.message !== undefined)
    return (
      <p role="status" className="toast toast-success">
        {state.message}
      </p>
    )

  return null
}

/** Names a new organization; the person creating it is its admin. */
export function CreateOrganizationForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, NOTHING_YET)

  return (
    <form action={action} className="stack">
      <div className="field">
        <label className="label" htmlFor="organization-name">
          Organization name
        </label>
        <input
          id="organization-name"
          name="name"
          className="input"
          placeholder="Lumen Labs"
          aria-invalid={state.error !== undefined}
          required
        />
      </div>
      <Outcome state={state} />
      <button className="btn btn-primary" aria-busy={pending} disabled={pending}>
        Create organization
      </button>
    </form>
  )
}

/** Invites someone to `organization` by email; Clerk sends the invitation. */
export function InviteForm({ organization }: { readonly organization: string }) {
  const [state, action, pending] = useActionState(inviteAction, NOTHING_YET)

  return (
    <form action={action} className="stack">
      <input type="hidden" name="organization" value={organization} />
      <div className="field">
        <label className="label" htmlFor="invite-email">
          Email address
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          className="input"
          placeholder="bob@lumen.test"
          aria-invalid={state.error !== undefined}
          required
        />
      </div>
      <Outcome state={state} />
      <button className="btn btn-primary" aria-busy={pending} disabled={pending}>
        Send invitation
      </button>
    </form>
  )
}
