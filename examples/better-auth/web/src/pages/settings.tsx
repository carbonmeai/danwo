/**
 * Account settings: the ways you sign in (and linking Google or GitHub to this account), the
 * devices signed in as you (and signing out every one but this), and signing out.
 */
import { useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router"

import { authClient, explain, explainReturn } from "../auth-client.ts"
import { PROVIDERS, type ProviderId } from "./social.tsx"

/** How a Better Auth provider id reads on the page. */
export function providerName(id: string): string {
  if (id === "credential") return "Password"

  return PROVIDERS.find((provider) => provider.id === id)?.name ?? id
}

interface Account {
  readonly id: string
  readonly providerId: string
  readonly createdAt: Date
}

interface Device {
  readonly id: string
  readonly userAgent?: string | null | undefined
  readonly createdAt: Date
}

/** "Chrome on macOS" from a user agent, or "A browser" when it says nothing useful. */
function deviceName(agent: string | null | undefined): string {
  if (!agent) return "A browser"

  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Chrome\//.test(agent)
      ? "Chrome"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Safari\//.test(agent)
          ? "Safari"
          : "A browser"
  const system = /Mac OS X/.test(agent)
    ? "macOS"
    : /Windows/.test(agent)
      ? "Windows"
      : /Android/.test(agent)
        ? "Android"
        : /Linux/.test(agent)
          ? "Linux"
          : undefined

  return system ? `${browser} on ${system}` : browser
}

const when = (date: Date) =>
  new Date(date).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })

export function Settings() {
  return (
    <div className="stack">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-description">
          How you sign in to Harbor, and where you&apos;re signed in.
        </p>
      </div>
      <LinkedAccounts />
      <Devices />
      <SignOut />
    </div>
  )
}

function LinkedAccounts() {
  const [params] = useSearchParams()
  const returned = params.get("error")
  const linked = params.get("linked")
  const [accounts, setAccounts] = useState<readonly Account[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void authClient.listAccounts().then(({ data }) => setAccounts(data ?? []))
  }, [])

  async function link(provider: ProviderId) {
    setBusy(true)
    setError(null)

    const { error } = await authClient.linkSocial({
      provider,
      callbackURL: `/settings?linked=${provider}`,
      errorCallbackURL: "/settings",
    })

    if (error) {
      setBusy(false)
      setError(explain(error))
    }
  }

  const has = new Set(accounts?.map((account) => account.providerId))

  return (
    <section className="card" aria-labelledby="accounts-title">
      <div className="card-header">
        <h2 className="card-title" id="accounts-title">
          Ways to sign in
        </h2>
        <p className="card-description">
          A code emailed to you always works. Link Google or GitHub to sign in with them too.
        </p>
      </div>
      <div className="card-body stack">
        {returned ? (
          <p className="toast toast-error" role="alert">
            {explainReturn(returned)}
          </p>
        ) : null}
        {linked && has.has(linked) ? (
          <p className="toast toast-success" role="status">
            {providerName(linked)} is linked. You can sign in with it now.
          </p>
        ) : null}
        {error ? (
          <p className="toast toast-error" role="alert">
            {error}
          </p>
        ) : null}
        <ul className="list" aria-label="Linked accounts">
          <li>
            <span>Emailed code</span>
            <span className="badge">Always on</span>
          </li>
          {accounts?.map((account) => (
            <li key={account.id}>
              <span>{providerName(account.providerId)}</span>
              <span className="muted text-sm">Linked {when(account.createdAt)}</span>
            </li>
          ))}
        </ul>
        <div className="row">
          {accounts === null
            ? null
            : PROVIDERS.filter((provider) => !has.has(provider.id)).map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void link(provider.id)}
                >
                  Link {provider.name}
                </button>
              ))}
        </div>
      </div>
    </section>
  )
}

function Devices() {
  const { data } = authClient.useSession()
  const [devices, setDevices] = useState<readonly Device[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data } = await authClient.listSessions()

    setDevices(data ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function signOutOthers() {
    setBusy(true)
    setMessage(null)

    const others = (devices?.length ?? 1) - 1
    const { error } = await authClient.revokeOtherSessions()

    await load()
    setBusy(false)
    setMessage(
      error
        ? { ok: false, text: explain(error) }
        : {
            ok: true,
            text: `Signed out ${others === 1 ? "1 other device" : `${others} other devices`}.`,
          },
    )
  }

  const current = data?.session.id

  return (
    <section className="card" aria-labelledby="devices-title">
      <div className="card-header">
        <h2 className="card-title" id="devices-title">
          Signed-in devices
        </h2>
        <p className="card-description">Every browser signed in as you right now.</p>
      </div>
      <div className="card-body stack">
        {message ? (
          <p
            className={`toast ${message.ok ? "toast-success" : "toast-error"}`}
            role={message.ok ? "status" : "alert"}
          >
            {message.text}
          </p>
        ) : null}
        <ul className="list" aria-label="Signed-in devices">
          {devices?.map((device) => (
            <li key={device.id}>
              <span>
                {deviceName(device.userAgent)}{" "}
                {device.id === current ? (
                  <span className="badge badge-success">This device</span>
                ) : null}
              </span>
              <span className="muted text-sm">Since {when(device.createdAt)}</span>
            </li>
          ))}
        </ul>
        <div className="row">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || (devices?.length ?? 0) < 2}
            onClick={signOutOthers}
          >
            Sign out other devices
          </button>
        </div>
      </div>
    </section>
  )
}

function SignOut() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    await authClient.signOut()
    await navigate("/sign-in")
  }

  return (
    <section className="card" aria-labelledby="sign-out-title">
      <div className="card-header">
        <h2 className="card-title" id="sign-out-title">
          Sign out
        </h2>
        <p className="card-description">Sign out of Harbor on this device.</p>
      </div>
      <div className="card-footer">
        <button type="button" className="btn btn-danger" disabled={busy} onClick={signOut}>
          Sign out of this device
        </button>
      </div>
    </section>
  )
}
