import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

/** The front door: the dashboard when signed in, the sign-in page when not. */
export default async function Home() {
  const { userId } = await auth()

  redirect(userId === null ? "/sign-in" : "/dashboard")
}
