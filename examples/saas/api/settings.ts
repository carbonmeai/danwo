/**
 * What the API reads from its environment, checked once at start-up so a missing value fails
 * loudly rather than halfway through an onboarding.
 */
import { z } from "zod"

const Env = z.object({
  PORT: z.coerce.number().int().default(4400),
  /** Where the web app answers, for links in emails and OAuth redirects. */
  WEB_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  /** Clerk's public key, so session tokens verify without a network call. */
  CLERK_JWT_KEY: z.string().min(1),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().startsWith("whsec_"),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  SLACK_CLIENT_ID: z.string().min(1),
  SLACK_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  PUSHER_APP_ID: z.string().min(1),
  PUSHER_KEY: z.string().min(1),
  PUSHER_SECRET: z.string().min(1),
  PUSHER_CLUSTER: z.string().min(1),
  /** Signs the `state` of an OAuth round trip, so a callback can't be forged. */
  STATE_SECRET: z.string().min(16),
})

export const settings = Env.parse(process.env)
