import type { Auth0RouteContext } from "../context.ts"
import type { Auth0JobRecord } from "../entities.ts"
import { hexId, jsonBody, ManagementError, opaque, requestHost } from "../helpers.ts"
import { requireScope } from "../management.ts"

const jobView = (job: Auth0JobRecord) => ({
  type: job.type,
  status: "completed",
  created_at: job.created_at,
  id: job.jobId,
})

/** Verification-email jobs: the email is "sent" at once, with a link that verifies the address. */
export function jobRoutes(context: Auth0RouteContext): void {
  const { app } = context

  app.post("/api/v2/jobs/verification-email", async (c) => {
    const { tenant } = requireScope(c, "update:users")
    const body = await jsonBody(c)
    const userId = typeof body.user_id === "string" ? body.user_id : ""
    const auth0 = context.auth0()
    const user = auth0.users
      .findBy("user_id", userId)
      .find((found) => found.tenant === tenant.domain)

    if (!user) throw new ManagementError(404, "The user does not exist.", "inexistent_user")

    const ticket = opaque(24)

    auth0.emails.insert({
      tenant: tenant.domain,
      to: user.email,
      kind: "verify_email",
      link: `https://${requestHost(c)}/u/email-verification?ticket=${ticket}`,
      ticket,
      used: false,
    })

    const job = auth0.jobs.insert({
      jobId: `job_${hexId(8)}`,
      tenant: tenant.domain,
      type: "verification_email",
      user_id: user.user_id,
    })

    return c.json(jobView(job), 201)
  })

  app.get("/api/v2/jobs/:id", (c) => {
    const { tenant } = requireScope(c, "read:users")
    const job = context
      .auth0()
      .jobs.findBy("jobId", c.req.param("id"))
      .find((found) => found.tenant === tenant.domain)

    if (!job) throw new ManagementError(404, "The job does not exist.", "inexistent_job")

    return c.json(jobView(job))
  })
}
