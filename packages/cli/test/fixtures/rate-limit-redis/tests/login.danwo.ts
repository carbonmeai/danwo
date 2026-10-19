import { test, z } from "@danwo/sdk"

const Audit = z.object({ allowed: z.number() })

test("turns the third sign-in attempt away", async ({ app, expect }) => {
  const statuses: number[] = []

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(new URL("/login", app.baseUrl), {
      method: "POST",
      headers: { user: "ada" },
    })

    statuses.push(response.status)
  }

  expect(statuses).toEqual([200, 200, 429])
}).invariant(async ({ app, expect }) => {
  const audit = Audit.parse(await (await fetch(new URL("/audit", app.baseUrl))).json())

  // Whatever Redis did, no more than two attempts a minute got through.
  expect(audit.allowed).toBeLessThanOrEqual(2)
})
