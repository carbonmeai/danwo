/**
 * The customer's email, kept in a cookie once they book, so the class page and My bookings
 * remember who they are without an account.
 */
import type { Cookies } from "@sveltejs/kit"

const EMAIL_COOKIE = "studio_email"

/** The email this browser booked with last, or an empty string. */
export function rememberedEmail(cookies: Cookies): string {
  return cookies.get(EMAIL_COOKIE) ?? ""
}

/** Remembers `email` for this browser. */
export function rememberEmail(cookies: Cookies, url: URL, email: string): void {
  cookies.set(EMAIL_COOKIE, email, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
  })
}
