/**
 * `SAAS_BUG` turns one of Relay's safeguards off, so a reader can watch the fault matrix catch it.
 * Every process reads the same variable; each safeguard checks for its own name.
 */
import { z } from "zod"

const Bug = z
  .enum([
    /** Onboarding calls Clerk and Stripe once, with no retry, idempotency key or recovery. */
    "no-onboarding-retry",
    /** The Slack post is sent without first checking whether an earlier attempt landed. */
    "no-slack-dedupe",
    /** Webhooks are acted on every time they arrive, and their jobs get fresh ids. */
    "no-webhook-dedupe",
  ])
  .optional()

export type Bug = NonNullable<z.infer<typeof Bug>>

const bug = Bug.parse(process.env.SAAS_BUG || undefined)

/** Whether the safeguard `name` is turned off for this run. */
export function broken(name: Bug): boolean {
  return bug === name
}
