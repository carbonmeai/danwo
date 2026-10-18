/*
 * A small Express app signed in with Clerk, written the way such apps are: @clerk/express on the
 * server, ClerkJS and its <SignIn/> in the page, loaded from the instance's Frontend API. The home
 * page greets the signed-in user by the email the Backend API has for them; `/api/me` answers who
 * the request's session belongs to. It knows nothing about danwo.
 *
 * Env: PORT, CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY. CLERK_BUG=trust-cookie makes `/api/me` read
 * the user from the `__session` cookie without verifying it, so a forged token is believed: a bug
 * to catch.
 */
import { clerkClient, clerkMiddleware, getAuth } from "@clerk/express"
import express, { type Request } from "express"

const publishableKey = process.env["CLERK_PUBLISHABLE_KEY"] ?? ""
const frontendApi = Buffer.from(publishableKey.replace(/^pk_test_/, ""), "base64")
  .toString()
  .replace(/\$$/, "")
const trustCookie = process.env["CLERK_BUG"] === "trust-cookie"

const scripts = `
<script async crossorigin="anonymous" data-clerk-publishable-key="${publishableKey}"
  src="https://${frontendApi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js"></script>
<script async crossorigin="anonymous" src="https://${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js"></script>
<script>
  window.addEventListener("load", async () => {
    while (!(window.Clerk && window.__internal_ClerkUICtor)) await new Promise((r) => setTimeout(r, 50))
    await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } })
    const mount = document.getElementById("sign-in")
    if (mount && !window.Clerk.user) window.Clerk.mountSignIn(mount, { forceRedirectUrl: "/" })
    // Signed in here but not on the server yet: ask again, a few times at most.
    const tries = Number(sessionStorage.getItem("reloads") ?? 0)
    if (mount && window.Clerk.user && tries < 3) {
      sessionStorage.setItem("reloads", String(tries + 1))
      location.reload()
    }
  })
</script>`

const page = (title: string, body: string) =>
  `<!doctype html><title>${title}</title><main><h1>${title}</h1>${body}</main>${scripts}`

/** The user a request's `__session` cookie names, read without checking its signature. */
function unverifiedUser(req: Request): string | null {
  const token = /(?:^|;\s*)__session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1]
  const payload = token?.split(".")[1]

  if (payload === undefined) return null

  const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString())

  return claims !== null &&
    typeof claims === "object" &&
    "sub" in claims &&
    typeof claims.sub === "string"
    ? claims.sub
    : null
}

/** The email the Backend API has for a user, or null when Clerk could not be reached. */
async function emailOf(userId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(userId)

    return user.primaryEmailAddress?.emailAddress ?? null
  } catch {
    return null
  }
}

const app = express()

app.use(clerkMiddleware())

/** The home page: the sign-in form, or a greeting with the email Clerk has for the user. */
async function home(req: Request): Promise<string> {
  const { userId } = getAuth(req)

  if (userId === null) return page("Sign in", `<div id="sign-in"></div>`)

  const email = await emailOf(userId)

  return page(
    "Signed in",
    `<p role="status">${email ?? "Your profile could not be loaded right now."}</p>`,
  )
}

app.get("/", (req, res, next) => {
  home(req).then((html) => res.send(html), next)
})

app.get("/api/me", (req, res) => {
  const userId = trustCookie ? unverifiedUser(req) : getAuth(req).userId

  if (userId === null) {
    res.status(401).json({ error: "signed out" })

    return
  }

  res.json({ userId })
})

app.listen(Number(process.env["PORT"]), "127.0.0.1", () => console.log("listening"))
