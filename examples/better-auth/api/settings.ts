/**
 * What the API reads from its environment, checked once at start-up so a missing value fails
 * loudly rather than halfway through a sign-in.
 */
import { z } from "zod"

/** The safeguards a reader can turn off, to watch the tests and the fault matrix catch it. */
export const BUGS = ["no-rate-limit", "no-idempotency-key", "no-unique-email"] as const

export type Bug = (typeof BUGS)[number]

const Env = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  /** Where people reach Harbor, e.g. `http://localhost:5173`: the base of every link and callback. */
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().startsWith("re_"),
  MAIL_FROM: z.string().default("Harbor <sign-in@harbor.test>"),
  /** The built web app (`vite build web`), served beside the API. Left out in development. */
  WEB_DIST: z.string().optional(),
  /**
   * Turns one of the app's safeguards off: `no-rate-limit` lets anyone ask for codes without
   * limit, `no-idempotency-key` sends email without an idempotency key, and `no-unique-email`
   * lets two people share one email address.
   */
  BETTER_AUTH_BUG: z.enum(BUGS).optional(),
})

export const settings = Env.parse(process.env)

/** Whether the safeguard `bug` names is turned off for this run. */
export function broken(bug: Bug): boolean {
  return settings.BETTER_AUTH_BUG === bug
}
