/** Clerk's sign-in, by emailed code. */
import { SignIn } from "@clerk/tanstack-react-start"
import { createFileRoute } from "@tanstack/react-router"

import { Logo } from "../components/shell"

export const Route = createFileRoute("/sign-in/$")({ component: SignInPage })

function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <Logo />
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/" />
    </main>
  )
}
