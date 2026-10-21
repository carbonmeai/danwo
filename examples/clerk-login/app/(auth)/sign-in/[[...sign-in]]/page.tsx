import { SignIn } from "@clerk/nextjs"

/** Clerk's sign-in, every step of it under `/sign-in` (the code, Google's return, a ticket). */
export default function SignInPage() {
  return <SignIn path="/sign-in" />
}
