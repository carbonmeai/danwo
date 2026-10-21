import { afterEach, describe, expect, it } from "vitest"

import { clerkInstance } from "../src/clerk/index.ts"
import { clerkTestbed, frontend } from "./clerk-client.ts"

const APP = "http://127.0.0.1:4100"
const FAPI = "https://danwo-app.clerk.accounts.dev"

let bed: ReturnType<typeof clerkTestbed>

afterEach(() => bed.close())

/** Ada, with her organization. */
const SEED = {
  instance: { password: false },
  users: [{ email: "ada@danwo.test", firstName: "Ada" }],
  organizations: [{ name: "Acme", members: [{ email: "ada@danwo.test", role: "org:admin" }] }],
}

/** Ada invites Bob to Acme through the Backend API; the invitation and the link it emailed. */
async function inviteBob() {
  const view = clerkInstance(bed.emulator)
  const invited = await bed.client.organizations.createOrganizationInvitation({
    organizationId: view.organizations()[0]?.id ?? "",
    inviterUserId: view.user("ada@danwo.test")?.id ?? "",
    emailAddress: "bob@danwo.test",
    role: "org:member",
    redirectUrl: `${APP}/sign-up`,
  })
  const link = /https:\/\/\S+ticket=\S+/.exec(view.messages("bob@danwo.test")[0]?.body ?? "")?.[0]

  return { invited, link: link ?? "" }
}

/** Where opening `link` sends the browser. */
async function follow(link: string): Promise<URL> {
  const answer = await bed.emulator.fetch(new Request(link))

  return new URL(answer.headers.get("location") ?? "")
}

describe("Clerk organization invitations", () => {
  it("emails the invitee a link to the Frontend API's ticket page", async () => {
    bed = clerkTestbed(SEED)

    const { invited, link } = await inviteBob()
    const [email] = clerkInstance(bed.emulator).messages("bob@danwo.test")

    expect(email?.subject).toBe("Ada invited you to join Acme")
    expect(link.startsWith(`${FAPI}/v1/tickets/accept?ticket=`)).toBe(true)
    expect(invited.url).toBe(link)

    const landing = await follow(link)

    expect(`${landing.origin}${landing.pathname}`).toBe(`${APP}/sign-up`)
    expect(landing.searchParams.get("__clerk_status")).toBe("sign_up")
  })

  it("signs the invitee up and into the organization with the ticket, once", async () => {
    bed = clerkTestbed(SEED)

    const view = clerkInstance(bed.emulator)
    const { link } = await inviteBob()
    const ticket = (await follow(link)).searchParams.get("__clerk_ticket") ?? ""
    const fapi = frontend(bed.emulator, APP)
    const signUp = () =>
      fapi.devBrowser().then((dvb) =>
        fapi.call("/v1/client/sign_ups", {
          method: "POST",
          devBrowser: dvb,
          form: { strategy: "ticket", ticket },
        }),
      )

    expect(fapi.at((await signUp()).body, "response")).toMatchObject({
      status: "complete",
      email_address: "bob@danwo.test",
    })
    expect(view.memberships(view.organizations()[0]?.id).map((m) => m.role)).toEqual([
      "org:admin",
      "org:member",
    ])
    expect((await signUp()).body).toMatchObject({ errors: [{ code: "ticket_expired" }] })
    expect((await follow(link)).searchParams.get("__clerk_status")).toBe("expired")
  })

  it("signs an invitee who already has an account in with the ticket", async () => {
    bed = clerkTestbed({ ...SEED, users: [...SEED.users, { email: "bob@danwo.test" }] })

    const view = clerkInstance(bed.emulator)
    const org = view.organizations()[0]

    await bed.client.organizations.createOrganizationInvitation({
      organizationId: org?.id ?? "",
      emailAddress: "bob@danwo.test",
      role: "org:member",
    })

    const ticket = /ticket=(\S+)/.exec(view.messages("bob@danwo.test")[0]?.body ?? "")?.[1] ?? ""
    const fapi = frontend(bed.emulator, APP)
    const signIn = await fapi.call("/v1/client/sign_ins", {
      method: "POST",
      devBrowser: await fapi.devBrowser(),
      form: { strategy: "ticket", ticket },
    })

    expect(fapi.at(signIn.body, "response")).toMatchObject({ status: "complete" })
    expect(view.memberships(org?.id)).toHaveLength(2)
  })
})
