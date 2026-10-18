import { afterEach, describe, expect, it } from "vitest"

import { clerkInstance } from "../src/clerk/index.ts"
import { clerkTestbed } from "./clerk-client.ts"

let bed: ReturnType<typeof clerkTestbed>

afterEach(() => bed.close())

const APP = "http://localhost:3000"

/** A browser's cookies for the app, as `Set-Cookie` directives leave them. */
class Jar {
  private readonly cookies = new Map<string, string>()

  take(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const [pair = ""] = line.split(";")
      const [name = "", ...value] = pair.split("=")
      const maxAge = /Max-Age=(\d+)/i.exec(line)?.[1]

      if (maxAge === "0") this.cookies.delete(name)
      else this.cookies.set(name, value.join("="))
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
  }
}

/** A page load of the app, as a browser sends it. */
function navigation(url: string, jar: Jar): Request {
  return new Request(url, {
    headers: { accept: "text/html", "sec-fetch-dest": "document", cookie: jar.header() },
  })
}

/** Asks the app's middleware who this browser is, following handshakes the way a browser would. */
async function authenticate(url: string, jar: Jar) {
  let state = await bed.client.authenticateRequest(navigation(url, jar), {
    publishableKey: bed.publishableKey,
    secretKey: bed.secretKey,
  })

  for (let hops = 0; state.status === "handshake" && hops < 4; hops++) {
    const handshake = await fetch(state.headers.get("location") ?? "", { redirect: "manual" })
    const back = handshake.headers.get("location") ?? ""

    state = await bed.client.authenticateRequest(navigation(back, jar), {
      publishableKey: bed.publishableKey,
      secretKey: bed.secretKey,
    })
    jar.take(state.headers)
  }

  return state
}

/** Signs in on the Account Portal with a password, as the browser would. */
async function signInOnPortal(jar: Jar, email: string, password: string): Promise<string> {
  const devBrowser = jar.get("__clerk_db_jwt") ?? ""
  const form = new URLSearchParams({ identifier: email, password, redirect_url: `${APP}/dashboard`, __clerk_db_jwt: devBrowser })
  const answer = await fetch(`https://danwo-app.accounts.dev/sign-in`, {
    method: "POST",
    body: form,
    redirect: "manual",
  })

  expect(answer.status).toBe(303)

  return answer.headers.get("location") ?? ""
}

describe("Clerk sessions in an app's middleware", () => {
  it("hands a new browser a dev browser, then signs it in through the Account Portal and a handshake", async () => {
    bed = clerkTestbed({ users: [{ email: "ada@danwo.test", password: "s3cret-pass" }] })

    const jar = new Jar()
    const anonymous = await authenticate(`${APP}/`, jar)

    expect(anonymous.status).toBe("signed-out")
    expect(jar.get("__clerk_db_jwt")).toMatch(/^dvb_/)
    expect(jar.get("__client_uat")).toBe("0")

    const back = await signInOnPortal(jar, "ada@danwo.test", "s3cret-pass")

    expect(new URL(back).searchParams.get("__clerk_db_jwt")).toBe(jar.get("__clerk_db_jwt"))

    const signedIn = await authenticate(back, jar)

    expect(signedIn.status).toBe("signed-in")
    expect(signedIn.toAuth()).toMatchObject({ userId: clerkInstance(bed.emulator).user("ada@danwo.test")?.id })

    const again = await bed.client.authenticateRequest(navigation(`${APP}/dashboard`, jar), {
      publishableKey: bed.publishableKey,
      secretKey: bed.secretKey,
    })

    expect(again.status).toBe("signed-in")
  })

  it("refuses a wrong password on the portal, and signs a revoked session out at the next handshake", async () => {
    bed = clerkTestbed({ users: [{ email: "ada@danwo.test", password: "s3cret-pass" }] })

    const jar = new Jar()

    await authenticate(`${APP}/`, jar)

    const wrong = await fetch("https://danwo-app.accounts.dev/sign-in", {
      method: "POST",
      body: new URLSearchParams({ identifier: "ada@danwo.test", password: "nope", redirect_url: APP }),
    })

    expect(wrong.status).toBe(422)
    expect(await wrong.text()).toContain("Password is incorrect")

    const signedIn = await authenticate(await signInOnPortal(jar, "ada@danwo.test", "s3cret-pass"), jar)

    expect(signedIn.status).toBe("signed-in")
    expect(clerkInstance(bed.emulator).revokeSessions("ada@danwo.test")).toBe(1)

    const afterRevoke = await authenticate(`${APP}/?__clerk_db_jwt=${jar.get("__clerk_db_jwt") ?? ""}`, jar)

    expect(afterRevoke.status).toBe("signed-out")
  })

  it("signs in by emailed code when the instance has no passwords", async () => {
    bed = clerkTestbed({ instance: { password: false }, users: [{ email: "ada@danwo.test" }] })

    const jar = new Jar()

    await authenticate(`${APP}/`, jar)

    const asked = await fetch("https://danwo-app.accounts.dev/sign-in", {
      method: "POST",
      body: new URLSearchParams({ identifier: "ada@danwo.test", redirect_url: APP, __clerk_db_jwt: jar.get("__clerk_db_jwt") ?? "" }),
    })
    const page = await asked.text()
    const attempt = /name="attempt" value="([^"]+)"/.exec(page)?.[1] ?? ""
    const code = await clerkInstance(bed.emulator).code("ada@danwo.test")
    const verified = await fetch("https://danwo-app.accounts.dev/sign-in/verify", {
      method: "POST",
      body: new URLSearchParams({ attempt, code, redirect_url: APP, __clerk_db_jwt: jar.get("__clerk_db_jwt") ?? "" }),
      redirect: "manual",
    })

    expect(page).toContain("Verification code")
    expect(verified.status).toBe(303)
    await expect(authenticate(verified.headers.get("location") ?? "", jar)).resolves.toMatchObject({
      status: "signed-in",
    })
  })
})
