import { join, normalEmail } from "../../../lib/waitlist.ts"

/** Joins the waitlist: `{ email }` in, `{ status, count }` or `{ error }` out. */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined)
  const email = normalEmail(Reflect.get(Object(body), "email"))

  if (email === undefined)
    return Response.json({ error: "Enter a valid email address." }, { status: 400 })

  try {
    return Response.json(await join(email))
  } catch (error) {
    console.error("join failed:", error)

    return Response.json(
      { error: "We couldn't add you just now. Please try again in a minute." },
      { status: 503 },
    )
  }
}
