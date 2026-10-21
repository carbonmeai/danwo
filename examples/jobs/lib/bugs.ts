/**
 * `JOBS_BUG` turns the jobs' safeguards off, one or both (`no-idempotency,no-step`), so a reader
 * can watch the fault matrix catch what each one was there for:
 * - `no-idempotency`: Resend and Stripe are called without idempotency keys, so a step retried
 *   after the provider acted, but before its answer arrived, sends the email or bills the batch a
 *   second time;
 * - `no-step`: the email is sent from the function's body rather than inside `step.run`, so every
 *   time Inngest runs the function again (a later step failed, say) the email goes again.
 */
import { z } from "zod"

const Bug = z.enum(["no-idempotency", "no-step"])

const bugs = new Set(
  (process.env.JOBS_BUG ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
    .map((name) => Bug.parse(name)),
)

/** Whether the safeguard `name` names is off for this run. */
export function broken(name: z.infer<typeof Bug>): boolean {
  return bugs.has(name)
}
