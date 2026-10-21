import { auth } from "@clerk/nextjs/server"
import { cookies } from "next/headers"

export const dynamic = "force-dynamic"

/**
 * Who the server thinks is asking, and whether the request still carries a Clerk session cookie
 * (`__session`, or the suffixed copy Clerk also sets). After signing out, neither should be left.
 */
export async function GET(): Promise<Response> {
  const { userId, sessionId } = await auth()
  const jar = await cookies()
  const sessionCookie = jar.getAll().some((cookie) => /^__session(_|$)/.test(cookie.name))

  return Response.json({ userId, sessionId, sessionCookie })
}
