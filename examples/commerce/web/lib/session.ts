/** The guest's cookies: the cart they are filling, and the email they paid with last. */
import { cookies } from "next/headers"

const CART = "cart"
const EMAIL = "email"
const YEAR = 60 * 60 * 24 * 365

/** The guest's cart id, or undefined before they add anything. */
export async function cartId(): Promise<string | undefined> {
  return (await cookies()).get(CART)?.value
}

/** The guest's cart id, made and kept in a cookie on first use. */
export async function ensureCartId(): Promise<string> {
  const jar = await cookies()
  const existing = jar.get(CART)?.value

  if (existing) return existing

  const id = crypto.randomUUID()

  jar.set(CART, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: YEAR })

  return id
}

/** The email the guest last paid with, to find their orders by. */
export async function savedEmail(): Promise<string | undefined> {
  return (await cookies()).get(EMAIL)?.value
}

export async function saveEmail(email: string): Promise<void> {
  ;(await cookies()).set(EMAIL, email, { httpOnly: true, sameSite: "lax", path: "/", maxAge: YEAR })
}

/** A 303 to a path on this site, the answer to a form post. */
export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location } })
}
