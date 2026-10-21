/**
 * "Continue with Google" and "Continue with GitHub": Better Auth sends the browser to the
 * provider's consent screen, and back to `callbackURL` signed in (or to `errorCallbackURL` with an
 * `?error=`).
 */
import { useState } from "react"

import { authClient, explain } from "../auth-client.ts"

/** The providers Harbor signs in with, by Better Auth's id. */
export const PROVIDERS = [
  { id: "google", name: "Google" },
  { id: "github", name: "GitHub" },
] as const

export type ProviderId = (typeof PROVIDERS)[number]["id"]

interface SocialProps {
  readonly callbackURL: string
  readonly errorCallbackURL: string
}

export function Social({ callbackURL, errorCallbackURL }: SocialProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go(provider: ProviderId) {
    setBusy(true)
    setError(null)

    const { error } = await authClient.signIn.social({ provider, callbackURL, errorCallbackURL })

    if (error) {
      setBusy(false)
      setError(explain(error))
    }
  }

  return (
    <div className="stack">
      {PROVIDERS.map((provider) => (
        <button
          key={provider.id}
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void go(provider.id)}
        >
          Continue with {provider.name}
        </button>
      ))}
      {error ? (
        <p className="toast toast-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
