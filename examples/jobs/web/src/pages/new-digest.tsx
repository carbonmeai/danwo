/**
 * Writing a new digest. The page picks the digest's id itself, so a form sent twice (a double
 * click, a retried request) makes one digest.
 */
import { type FormEvent, useState } from "react"

import { createDigest } from "../api.ts"
import { navigate } from "../router.tsx"
import { Topbar } from "../ui.tsx"

export function NewDigest() {
  const [id] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | undefined>()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = new FormData(event.currentTarget)

    setBusy(true)
    setProblem(undefined)
    try {
      await createDigest({
        id,
        title: String(form.get("title") ?? ""),
        intro: String(form.get("intro") ?? ""),
        ownerEmail: String(form.get("ownerEmail") ?? ""),
      })
      navigate(`/digests/${id}`)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      setBusy(false)
    }
  }

  return (
    <>
      <Topbar trail={[{ label: "Digests", to: "/" }, { label: "New digest" }]} />
      <main className="shell-content">
        <header className="page-header">
          <h1 className="page-title">New digest</h1>
          <p className="page-description">
            What it says, and who hears if a copy can't be delivered.
          </p>
        </header>
        <form className="card" onSubmit={(event) => void submit(event)}>
          <div className="card-body stack">
            <div className="field">
              <label className="label" htmlFor="title">
                Title
              </label>
              <input id="title" name="title" className="input" required maxLength={120} />
            </div>
            <div className="field">
              <label className="label" htmlFor="intro">
                Message
              </label>
              <textarea id="intro" name="intro" className="input" rows={4} />
            </div>
            <div className="field">
              <label className="label" htmlFor="ownerEmail">
                Owner's email
              </label>
              <input id="ownerEmail" name="ownerEmail" className="input" type="email" required />
              <p className="hint">They hear about any copy that can't be delivered.</p>
            </div>
            {problem && (
              <p className="error" role="alert">
                {problem}
              </p>
            )}
          </div>
          <div className="card-footer">
            <button className="btn btn-primary" type="submit" aria-busy={busy} disabled={busy}>
              Create digest
            </button>
          </div>
        </form>
      </main>
    </>
  )
}
