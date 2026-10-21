import { waitlistCount } from "../lib/waitlist.ts"
import { JoinForm } from "./join-form.tsx"
import { Topbar } from "./topbar.tsx"

/* The count is read on every request. */
export const dynamic = "force-dynamic"

export default async function WaitlistPage() {
  /* The form works without the count, so a slow or failing read doesn't take the page down. */
  const count = await waitlistCount().catch(() => null)

  return (
    <>
      <Topbar page="Waitlist" />
      <main className="shell-content">
        <header className="page-header">
          <h1 className="page-title">Join the waitlist</h1>
          <p className="page-description">
            Lumen opens to a few teams every week. Leave your email and we&apos;ll write when your
            seat is ready.
          </p>
        </header>
        <JoinForm initialCount={count} />
      </main>
    </>
  )
}
