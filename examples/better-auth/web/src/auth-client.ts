/**
 * Better Auth in the browser: every call goes to `/api/auth` on the page's own origin, and the
 * session cookie it sets is the only thing that says who is signed in.
 */
import { emailOTPClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({ plugins: [emailOTPClient()] })

/** What a failed call gives back: Better Auth's code when it has one, and the HTTP status. */
export interface AuthFailure {
  readonly code?: string | undefined
  readonly message?: string | undefined
  readonly status: number
}

/** The sentence a page shows for a failed call. */
export function explain(error: AuthFailure): string {
  if (error.status === 429) return "Too many tries. Wait a few minutes, then try again."

  switch (error.code) {
    case "INVALID_OTP":
      return "That code isn't right. Check the latest email from Harbor and try again."
    case "OTP_EXPIRED":
      return "That code has expired. Send a new one."
    case "TOO_MANY_ATTEMPTS":
      return "Too many wrong codes. That code no longer works; send a new one."
    case "EMAIL_NOT_SENT":
      return "We couldn't send the email just now. Please try again."
    case "EMAIL_NOT_VERIFIED":
      return "Confirm your email first: open the link we sent you."
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match."
    case "PASSWORD_TOO_SHORT":
      return "Use at least 10 characters for your password."
    default:
      return "Something went wrong. Please try again."
  }
}

/** The sentence for an `?error=` Better Auth put on the page after a Google or GitHub round trip. */
export function explainReturn(error: string): string {
  if (error === "access_denied") return "You cancelled. Nothing was changed."
  if (error === "account_already_linked_to_different_user")
    return "That account already belongs to someone else on Harbor."

  return "Signing in there didn't finish. Please try again."
}
