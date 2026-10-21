import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"

/** The pages only a signed-in person may see. */
const isProtected = createRouteMatcher(["/dashboard(.*)", "/profile(.*)", "/organization(.*)"])

/**
 * Clerk's middleware on every page: it reads the session from the request's cookies, and sends
 * anyone who is signed out from a protected page to the sign-in page, which brings them back.
 */
export default clerkMiddleware(
  async (auth, request) => {
    if (isProtected(request)) await auth.protect()
  },
  {
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
  },
)

export const config = {
  matcher: [
    /* Every page and route handler, but not Next.js's own files or static assets. */
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
