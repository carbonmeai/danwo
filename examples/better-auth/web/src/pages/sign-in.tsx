/**
 * Signing in: with Google or GitHub, with a six-digit code emailed to you, or with a password.
 * Asking for a code twice gives a new one; the newest email holds the one that works.
 */
import { type FormEvent, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { authClient, explain, explainReturn } from "../auth-client.ts"
import { AuthLayout } from "../layouts.tsx"
import { Social } from "./social.tsx"

type Step = { readonly kind: "email" } | { readonly kind: "code"; readonly email: string }

export function SignIn() {
  const [params] = useSearchParams()
  const returned = params.get("error")
  const [step, setStep] = useState<Step>({ kind: "email" })
  const [password, setPassword] = useState(false)

  return (
    <AuthLayout>
      <div className="stack">
        <div>
          <h1 className="page-title">
            {step.kind === "code" ? "Check your email" : "Sign in to Harbor"}
          </h1>
          <p className="page-description">
            {step.kind === "code"
              ? `We sent a 6-digit code to ${step.email}. It works for 5 minutes.`
              : "New here? Signing in with a code or with Google or GitHub makes your account."}
          </p>
        </div>
        {returned && step.kind === "email" ? (
          <p className="toast toast-error" role="alert">
            {explainReturn(returned)}
          </p>
        ) : null}
        {step.kind === "code" ? (
          <CodeForm email={step.email} onBack={() => setStep({ kind: "email" })} />
        ) : password ? (
          <PasswordForm onCode={() => setPassword(false)} />
        ) : (
          <>
            <Social callbackURL="/dashboard" errorCallbackURL="/sign-in" />
            <p className="divider">or</p>
            <EmailForm onSent={(email) => setStep({ kind: "code", email })} />
            <button type="button" className="btn btn-ghost" onClick={() => setPassword(true)}>
              Sign in with a password instead
            </button>
          </>
        )}
        <p className="muted text-sm">
          No account yet? <Link to="/sign-up">Sign up with a password</Link>, or just ask for a
          code.
        </p>
      </div>
    </AuthLayout>
  )
}

/** The first step: the address to email a code to. */
function EmailForm({ onSent }: { readonly onSent: (email: string) => void }) {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" })

    setBusy(false)
    if (error) setError(explain(error))
    else onSent(email.trim().toLowerCase())
  }

  return (
    <form className="stack" onSubmit={submit}>
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
      {error ? (
        <p className="toast toast-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
        Email me a code
      </button>
    </form>
  )
}

/** The second step: the code from the email, a new one if it's lost, or another address. */
function CodeForm({ email, onBack }: { readonly email: string; readonly onBack: () => void }) {
  const navigate = useNavigate()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)

    const { error } = await authClient.signIn.emailOtp({ email, otp: code.trim() })

    setBusy(false)
    if (error) setError(explain(error))
    else await navigate("/dashboard")
  }

  async function resend() {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)

    const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" })

    setBusy(false)
    if (error) setError(explain(error))
    else {
      setCode("")
      setNotice(`We sent a new code to ${email}. Use the newest email.`)
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor="code">
          Code
        </label>
        <input
          id="code"
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </div>
      {error ? (
        <p className="toast toast-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="toast toast-success" role="status">
          {notice}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
        Sign in
      </button>
      <div className="row">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={resend}>
          Send a new code
        </button>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Use a different email
        </button>
      </div>
    </form>
  )
}

/** Signing in with a password, for accounts made on the sign-up page. */
function PasswordForm({ onCode }: { readonly onCode: () => void }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)

    const { error } = await authClient.signIn.email({ email, password })

    setBusy(false)
    if (error) setError(explain(error))
    else await navigate("/dashboard")
  }

  return (
    <form className="stack" onSubmit={submit}>
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      {error ? (
        <p className="toast toast-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
        Sign in
      </button>
      <button type="button" className="btn btn-ghost" onClick={onCode}>
        Email me a code instead
      </button>
    </form>
  )
}
