/** Clerk's sign-up, confirmed with an emailed code; then on to onboarding or an invitation. */
import { SignUp } from "@clerk/tanstack-react-start"
import { createFileRoute } from "@tanstack/react-router"

import { Logo } from "../components/shell"

export const Route = createFileRoute("/sign-up/$")({ component: SignUpPage })

function SignUpPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <Logo />
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/" />
    </main>
  )
}
