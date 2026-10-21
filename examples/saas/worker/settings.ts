/** What the worker reads from its environment, checked once at start-up. */
import { z } from "zod"

const Env = z.object({
  PORT: z.coerce.number().int().default(4500),
  /** Where the web app answers, for links in emails and Slack posts. */
  WEB_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  RESEND_API_KEY: z.string().startsWith("re_"),
  MAIL_FROM: z.string().default("Relay <hello@relay.test>"),
})

export const settings = Env.parse(process.env)
