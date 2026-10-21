/**
 * What the API reads from its environment, checked once at start-up so a missing value fails
 * loudly rather than halfway through a checkout.
 */
import { z } from "zod"

const Env = z.object({
  PORT: z.coerce.number().int().default(4400),
  DATABASE_URL: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  RESEND_API_KEY: z.string().startsWith("re_"),
  MAIL_FROM: z.string().default("Paper & Clay <orders@paperandclay.test>"),
  IMAGES_BUCKET: z.string().default("paper-and-clay-images"),
  AWS_REGION: z.string().default("auto"),
  AWS_ENDPOINT_URL_S3: z.string().optional(),
  /**
   * Turns one of the shop's safeguards off, so a reader can watch the fault matrix catch it:
   * `no-webhook-dedupe`, `no-idempotency-key` or `no-txn`.
   */
  COMMERCE_BUG: z.enum(["no-webhook-dedupe", "no-idempotency-key", "no-txn"]).optional(),
})

export const settings = Env.parse(process.env)

/** Whether the safeguard `bug` names is turned off for this run. */
export function broken(bug: NonNullable<typeof settings.COMMERCE_BUG>): boolean {
  return settings.COMMERCE_BUG === bug
}
