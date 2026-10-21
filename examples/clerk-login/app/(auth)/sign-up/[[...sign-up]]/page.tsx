import { SignUp } from "@clerk/nextjs"

/**
 * Clerk's sign-up, every step of it under `/sign-up`. An invitation's link lands here too, with a
 * ticket Clerk reads to sign the invited person up and into the organization.
 */
export default function SignUpPage() {
  return <SignUp path="/sign-up" />
}
