import { s3Objects, type S3Fixtures, test as base, z } from "@danwo/sdk"

const test = base.extend<S3Fixtures>()

test("uploads a report to Tigris", async ({ app, expect }) => {
  const res = await fetch(`${app.baseUrl}/upload?name=report.txt`, { method: "POST" })

  expect(res.status).toBe(201)
}).invariant(async ({ app, s3, expect }) => {
  // Whichever way the upload went, the app counts exactly the objects S3 holds.
  const res = await fetch(`${app.baseUrl}/saved`)
  const { saved } = z.object({ saved: z.number() }).parse(await res.json())

  expect(s3Objects(s3).list("danwo-uploads", "uploads/").length).toBe(saved)
})
