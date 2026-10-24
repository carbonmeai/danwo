/**
 * One digest: who gets it and how each copy went, when it goes out, what it was billed, and the
 * run history the background jobs write as they work. The page polls while the jobs still have
 * work on the digest, so their progress shows without a reload.
 */
import { type FormEvent, useState } from "react"

import { addSubscriber, type Digest, getDigest, scheduleDigest } from "../api.ts"
import { clock, localInput, money, tomorrowAtNine, when } from "../format.ts"
import { Status, Topbar, usePolled } from "../ui.tsx"

const BUSY = new Set(["scheduled", "sending"])

/**
 * Whether the jobs still have work on `digest`: copies to send, a copy that failed for good whose
 * owner is not told yet, or emails sent but not billed. Each is read from the copies themselves,
 * so the page keeps watching until the last of them is done.
 */
function inProgress(digest: Digest): boolean {
  if (BUSY.has(digest.digest.status)) return true
  if (digest.digest.status === "draft") return false

  const unfinished = digest.subscribers.some(
    (copy) => copy.status === "queued" || (copy.status === "failed" && !copy.ownerNotifiedAt),
  )
  const billed = digest.charges.reduce((sum, charge) => sum + charge.quantity, 0)

  return unfinished || billed < digest.subscribers.length
}

/** What a form on the page is doing: idle, sending, or the problem it hit. */
type FormState = { readonly busy: boolean; readonly problem?: string }

function Subscribers({
  digest,
  onChange,
}: {
  readonly digest: Digest
  readonly onChange: () => void
}) {
  const [id, setId] = useState(() => crypto.randomUUID())
  const [form, setForm] = useState<FormState>({ busy: false })
  const open = digest.digest.status === "draft" || digest.digest.status === "scheduled"

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const element = event.currentTarget
    const data = new FormData(element)

    setForm({ busy: true })
    try {
      await addSubscriber(digest.digest.id, {
        id,
        email: String(data.get("email") ?? ""),
        name: String(data.get("name") ?? ""),
      })
      element.reset()
      setId(crypto.randomUUID())
      setForm({ busy: false })
      onChange()
    } catch (error) {
      setForm({ busy: false, problem: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <section className="card" aria-labelledby="subscribers">
      <div className="card-header">
        <h2 className="card-title" id="subscribers">
          Subscribers
        </h2>
        <p className="card-description">Each gets one copy. Its status shows how the send went.</p>
      </div>
      {digest.subscribers.length > 0 && (
        <div className="table-wrap">
          <table className="table" aria-label="Subscribers">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Delivery</th>
                <th className="num">Tries</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {digest.subscribers.map((subscriber) => (
                <tr key={subscriber.id}>
                  <td>{subscriber.name || "—"}</td>
                  <td>{subscriber.email}</td>
                  <td>
                    {subscriber.status === null ? (
                      <span className="muted">Not sent yet</span>
                    ) : (
                      <Status of={subscriber.status} />
                    )}
                  </td>
                  <td className="num">{subscriber.attempts || "—"}</td>
                  <td className="muted">
                    {subscriber.sentAt ? when(subscriber.sentAt) : (subscriber.error ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <form className="card-body row" onSubmit={(event) => void submit(event)}>
          <div className="field">
            <label className="label" htmlFor="subscriber-name">
              Name
            </label>
            <input id="subscriber-name" name="name" className="input" />
          </div>
          <div className="field">
            <label className="label" htmlFor="subscriber-email">
              Email
            </label>
            <input id="subscriber-email" name="email" className="input" type="email" required />
          </div>
          <button
            className="btn btn-secondary"
            type="submit"
            aria-busy={form.busy}
            disabled={form.busy}
          >
            Add subscriber
          </button>
          {form.problem && (
            <p className="error" role="alert">
              {form.problem}
            </p>
          )}
        </form>
      )}
    </section>
  )
}

function Schedule({
  digest,
  onChange,
}: {
  readonly digest: Digest
  readonly onChange: () => void
}) {
  const [form, setForm] = useState<FormState>({ busy: false })
  const [done, setDone] = useState<string | undefined>()
  const { status, sendAt } = digest.digest
  const open = status === "draft" || status === "scheduled"

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const at = new Date(String(new FormData(event.currentTarget).get("sendAt") ?? ""))

    setForm({ busy: true })
    try {
      await scheduleDigest(digest.digest.id, at)
      setForm({ busy: false })
      setDone(`Scheduled for ${when(at.toISOString())}.`)
      onChange()
    } catch (error) {
      setForm({ busy: false, problem: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <section className="card" aria-labelledby="schedule">
      <div className="card-header">
        <h2 className="card-title" id="schedule">
          Schedule
        </h2>
        <p className="card-description">
          {status === "draft"
            ? "Digests go out on the hour, at or after the time you pick."
            : `Goes out ${when(sendAt)}.`}
        </p>
      </div>
      {open && (
        <form className="card-body row" onSubmit={(event) => void submit(event)}>
          <div className="field">
            <label className="label" htmlFor="send-at">
              Send at
            </label>
            <input
              id="send-at"
              name="sendAt"
              className="input"
              type="datetime-local"
              required
              defaultValue={localInput(sendAt ? new Date(sendAt) : tomorrowAtNine())}
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            aria-busy={form.busy}
            disabled={form.busy || digest.subscribers.length === 0}
          >
            Schedule
          </button>
          {done && (
            <p className="toast toast-success" role="status">
              {done}
            </p>
          )}
          {form.problem && (
            <p className="error" role="alert">
              {form.problem}
            </p>
          )}
        </form>
      )}
    </section>
  )
}

function Billing({ digest }: { readonly digest: Digest }) {
  return (
    <section className="card" aria-labelledby="billing">
      <div className="card-header">
        <h2 className="card-title" id="billing">
          Billing
        </h2>
        <p className="card-description">
          Each batch of emails is one line on the team's Stripe invoice.
        </p>
      </div>
      <div className="card-body">
        {digest.charges.length === 0 ? (
          <p className="muted">Nothing billed yet.</p>
        ) : (
          <ul className="stack">
            {digest.charges.map((charge) => (
              <li key={charge.batch} data-testid="charge">
                Batch {charge.batch}: {charge.quantity} emails, {money(charge.amountCents)}{" "}
                <span className="muted">({charge.stripeItemId})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** The jobs' names as the run history shows them. */
const JOBS: Readonly<Record<string, string>> = {
  scheduler: "Scheduler",
  "send-one": "Send one",
  "send-one-failed": "Send one: on failure",
  charge: "Charge",
}

function RunHistory({ digest }: { readonly digest: Digest }) {
  return (
    <section className="card" aria-labelledby="runs">
      <div className="card-header">
        <h2 className="card-title" id="runs">
          Run history
        </h2>
        <p className="card-description">
          What the background jobs did, written by each step as it ran.
        </p>
      </div>
      {digest.activity.length === 0 ? (
        <div className="card-body">
          <p className="muted">No runs yet. They start when the digest is due.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Run history">
            <thead>
              <tr>
                <th>When</th>
                <th>Job</th>
                <th>What happened</th>
                <th className="num">Try</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {digest.activity.map((line) => (
                <tr key={line.key}>
                  <td className="muted">{clock(line.createdAt)}</td>
                  <td>{JOBS[line.job] ?? line.job}</td>
                  <td>{line.detail}</td>
                  <td className="num">{line.attempt}</td>
                  <td>
                    <Status of={line.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function DigestPage({ id }: { readonly id: string }) {
  const [version, setVersion] = useState(0)
  const loaded = usePolled(() => getDigest(id), {
    everyMs: 1_000,
    keepGoing: inProgress,
    version: `${id} ${version}`,
  })
  const reload = () => setVersion((n) => n + 1)
  const title = loaded.state === "ready" ? loaded.value.digest.title : "Digest"

  return (
    <>
      <Topbar trail={[{ label: "Digests", to: "/" }, { label: title }]} />
      <main className="shell-content stack">
        {loaded.state === "failed" && (
          <div className="toast toast-error" role="alert">
            {loaded.error}
          </div>
        )}
        {loaded.state === "ready" && (
          <>
            <header className="page-header">
              <div>
                <h1 className="page-title">{loaded.value.digest.title}</h1>
                <p className="page-description">
                  Owned by {loaded.value.digest.ownerEmail} ·{" "}
                  <span data-testid="digest-status">
                    <Status of={loaded.value.digest.status} />
                  </span>
                </p>
              </div>
            </header>
            <Subscribers digest={loaded.value} onChange={reload} />
            <Schedule digest={loaded.value} onChange={reload} />
            <Billing digest={loaded.value} />
            <RunHistory digest={loaded.value} />
          </>
        )}
      </main>
    </>
  )
}
