"use client"

import { type FormEvent, useState } from "react"

/** What the form shows under the button after a submit. */
type Outcome =
  | { readonly kind: "joined" | "already"; readonly email: string }
  | { readonly kind: "failed"; readonly message: string }

/** What `POST /api/join` answers. */
interface JoinAnswer {
  readonly status?: "joined" | "already"
  readonly count?: number
  readonly error?: string
}

/** The signup form, and the count beside it, which a join updates. */
export function JoinForm({ initialCount }: { readonly initialCount: number | null }) {
  const [count, setCount] = useState(initialCount)
  const [invalid, setInvalid] = useState<string>()
  const [outcome, setOutcome] = useState<Outcome>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim()

    setInvalid(undefined)
    setOutcome(undefined)
    setBusy(true)

    try {
      const response = await fetch("/api/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const answer = (await response.json()) as JoinAnswer

      if (response.status === 400) setInvalid(answer.error ?? "Enter a valid email address.")
      else if (answer.status) {
        setOutcome({ kind: answer.status, email })
        setCount(answer.count ?? null)
      } else setOutcome({ kind: "failed", message: answer.error ?? "Something went wrong." })
    } catch {
      setOutcome({ kind: "failed", message: "We couldn't reach the server. Please try again." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_15rem]">
      <section className="card" aria-labelledby="join-title">
        <div className="card-header">
          <h2 id="join-title" className="card-title">
            Request an invite
          </h2>
          <p className="card-description">
            One email when you join, and one when it&apos;s your turn.
          </p>
        </div>
        <form className="card-body stack" onSubmit={submit} noValidate>
          <div className="field">
            <label className="label" htmlFor="email">
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              placeholder="ada@company.com"
              autoComplete="email"
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? "email-error" : "email-hint"}
            />
            {invalid ? (
              <p id="email-error" className="error" role="alert">
                {invalid}
              </p>
            ) : (
              <p id="email-hint" className="hint">
                We never share it.
              </p>
            )}
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
              Join the waitlist
            </button>
          </div>
          {outcome && <OutcomeToast outcome={outcome} />}
        </form>
      </section>
      <section className="card" aria-labelledby="count-label">
        <div className="card-body stat">
          <span id="count-label" className="stat-label">
            On the waitlist
          </span>
          <span className="stat-value" data-testid="waitlist-count">
            {count ?? "–"}
          </span>
        </div>
        <div className="card-footer">
          <span>Invites go out on Mondays</span>
        </div>
      </section>
    </div>
  )
}

/** The confirmation, or why joining failed. */
function OutcomeToast({ outcome }: { readonly outcome: Outcome }) {
  if (outcome.kind === "failed")
    return (
      <div className="toast toast-error" role="alert">
        <div>
          <p className="toast-title">Not added yet</p>
          <p className="toast-text">{outcome.message}</p>
        </div>
      </div>
    )

  const joined = outcome.kind === "joined"

  return (
    <div className={`toast ${joined ? "toast-success" : ""}`} role="status">
      <div>
        <p className="toast-title">
          {joined ? "You're on the list" : "You're already on the list"}
        </p>
        <p className="toast-text">
          {joined
            ? `We sent a welcome email to ${outcome.email}.`
            : `We already sent a welcome email to ${outcome.email}.`}
        </p>
      </div>
    </div>
  )
}
