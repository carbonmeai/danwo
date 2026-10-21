/**
 * Signing up with a password. The account works once its owner opens the link Harbor emails;
 * the link signs them in too.
 */
import { type FormEvent, useState } from "react"
import { Link } from "react-router"

import { authClient, explain } from "../auth-client.ts"
import { AuthLayout } from "../layouts.tsx"

export function SignUp() {
  const [sentTo, setSentTo] = useState<string | null>(null)

  return (
    <AuthLayout>
      {sentTo === null ? <SignUpForm onSent={setSentTo} /> : <Confirm email={sentTo} />}
    </AuthLayout>
  )
}

function SignUpForm({ onSent }: { readonly onSent: (email: string) => void }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    const { error } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: "/dashboard",
    })

    setBusy(false)
    if (error) setError(explain(error))
    else onSent(email.trim().toLowerCase())
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div>
        <h1 className="page-title">Create your Harbor account</h1>
        <p className="page-description">We&apos;ll email you a link to confirm the address.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="name">
          Name
        </label>
        <input
          id="name"
          className="input"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="email">
          Email address
        </label>
        <input
          id="email"
          className="input"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="input"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="hint">At least 10 characters.</p>
      </div>
      {error ? (
        <p className="toast toast-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
        Create account
      </button>
      <p className="muted text-sm">
        Already have one? <Link to="/sign-in">Sign in</Link>
      </p>
    </form>
  )
}

/** After signing up: where the link went, and a way to have it sent again. */
function Confirm({ email }: { readonly email: string }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function resend() {
    setBusy(true)

    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/dashboard" })

    setBusy(false)
    setMessage(error ? { ok: false, text: explain(error) } : { ok: true, text: "Sent again." })
  }

  return (
    <div className="stack">
      <div>
        <h1 className="page-title">Confirm your email</h1>
        <p className="page-description">
          We sent a link to {email}. Open it to finish signing up; it signs you in.
        </p>
      </div>
      {message ? (
        <p
          className={`toast ${message.ok ? "toast-success" : "toast-error"}`}
          role={message.ok ? "status" : "alert"}
        >
          {message.text}
        </p>
      ) : null}
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={resend}>
        Send the link again
      </button>
    </div>
  )
}
