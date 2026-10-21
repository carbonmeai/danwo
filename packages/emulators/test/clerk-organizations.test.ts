import { afterEach, describe, expect, it } from "vitest"

import { clerkInstance, clerkOutboundFaults } from "../src/clerk/index.ts"
import { clerkTestbed, frontend } from "./clerk-client.ts"

const APP = "http://127.0.0.1:4100"

let bed: ReturnType<typeof clerkTestbed>

afterEach(() => bed.close())

/** Ada, with her organization. */
const SEED = {
  instance: { password: false },
  users: [{ email: "ada@danwo.test", firstName: "Ada" }],
  organizations: [{ name: "Acme", members: [{ email: "ada@danwo.test", role: "org:admin" }] }],
}

/** Signs Ada in on a new dev browser with her emailed code; the dev browser. */
async function signedInAda(fapi: ReturnType<typeof frontend>): Promise<string> {
  const dvb = await fapi.devBrowser()

  await fapi.call("/v1/client/sign_ins", {
    method: "POST",
    devBrowser: dvb,
    form: { identifier: "ada@danwo.test", strategy: "email_code" },
  })

  const signIn = await fapi.call("/v1/client", { devBrowser: dvb })
  const id = String(fapi.at(signIn.body, "response", "sign_in", "id"))

  await fapi.call(`/v1/client/sign_ins/${id}/attempt_first_factor`, {
    method: "POST",
    devBrowser: dvb,
    form: {
      strategy: "email_code",
      code: await clerkInstance(bed.emulator).code("ada@danwo.test"),
    },
  })

  return dvb
}

describe("Clerk organizations in the browser", () => {
  it("lists the signed-in user's memberships for <OrganizationSwitcher/>, and creates one", async () => {
    bed = clerkTestbed(SEED)

    const fapi = frontend(bed.emulator, APP)
    const signedOut = await fapi.call("/v1/me/organization_memberships", {
      devBrowser: await fapi.devBrowser(),
    })

    expect(signedOut.status).toBe(401)

    const dvb = await signedInAda(fapi)
    const mine = await fapi.call("/v1/me/organization_memberships?paginated=true", {
      devBrowser: dvb,
    })

    expect(fapi.at(mine.body, "response")).toMatchObject({
      total_count: 1,
      data: [{ role: "org:admin", organization: { name: "Acme", members_count: 1 } }],
    })

    const created = await fapi.call("/v1/organizations", {
      method: "POST",
      devBrowser: dvb,
      form: { name: "Lumen Labs" },
    })

    expect(fapi.at(created.body, "response")).toMatchObject({
      name: "Lumen Labs",
      slug: "lumen-labs",
    })
    expect(clerkInstance(bed.emulator).memberships()).toHaveLength(2)

    const suggestions = await fapi.call("/v1/me/organization_suggestions", { devBrowser: dvb })

    expect(fapi.at(suggestions.body, "response")).toEqual({ data: [], total_count: 0 })
  })
})

/** The statuses (or kinds) of the faults the matrix plans for a POST to `host` and `path`. */
function kinds(host: string, path: string) {
  return clerkOutboundFaults({ host, method: "POST", path }).map((f) =>
    "status" in f ? f.status : f.kind,
  )
}

describe("Clerk's fault catalogue by host", () => {
  it("leaves the Frontend API and the images alone, and faults the Backend API", () => {
    bed = clerkTestbed()

    expect(kinds("danwo-app.clerk.accounts.dev", "/v1/organizations")).toEqual([])
    expect(kinds("danwo-app.clerk.accounts.dev", "/v1/me/organization_memberships")).toEqual([])
    expect(kinds("img.clerk.com", "/static/google.svg")).toEqual([])
    expect(kinds("danwo-app.clerk.accounts.dev", "/v1/client/sessions/sess_1/tokens")).toEqual([
      500, 503,
    ])
    expect(kinds("api.clerk.com", "/v1/organizations")).toContain(429)
  })

  it("serves Clerk's images, so its components show no broken ones", async () => {
    bed = clerkTestbed()

    const avatar = await bed.emulator.fetch(
      new Request("https://img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdCJ9"),
    )

    expect(avatar.headers.get("content-type")).toBe("image/svg+xml")
  })
})
