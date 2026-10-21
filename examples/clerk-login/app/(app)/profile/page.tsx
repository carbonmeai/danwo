import { currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

import { AutoRefresh } from "../auto-refresh.tsx"

export const dynamic = "force-dynamic"

/** A date as people read it. */
function day(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

/** The signed-in person as Clerk has them, read with `currentUser()`. */
export default async function Profile() {
  /* One try per render: a failure says so, and the page asks again a second later. */
  const user = await currentUser().catch(() => undefined)

  if (user === null) redirect("/sign-in")
  if (user === undefined)
    return (
      <section className="card">
        <div className="card-body empty" role="status">
          <p className="empty-title">Loading your profile</p>
          <p className="empty-text">Clerk didn&apos;t answer just now. Trying again…</p>
          <AutoRefresh />
        </div>
      </section>
    )

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ")
  const google = user.externalAccounts.filter((account) => account.provider === "oauth_google")
  const rows = [
    ["Name", name || "Not given"],
    ["Email", user.primaryEmailAddress?.emailAddress ?? "None"],
    ["Signs in with", google.length > 0 ? "Google, or an emailed code" : "An emailed code"],
    ["Member since", day(user.createdAt)],
    ["Clerk user id", user.id],
  ] as const

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Profile</h1>
        <p className="page-description">Your account as Clerk keeps it.</p>
      </header>
      <section className="card">
        <dl className="card-body grid gap-3 sm:grid-cols-[10rem_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="muted">{label}</dt>
              <dd data-testid={`profile-${label.toLowerCase().replaceAll(" ", "-")}`}>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}
