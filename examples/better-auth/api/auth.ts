/**
 * Harbor's Better Auth: who may sign in, how, and how often. People sign in with a six-digit code
 * emailed to them, with Google or GitHub, or with a password whose address they confirmed by email.
 * Everything Better Auth keeps (people, linked accounts, sessions, codes, rate-limit counters) is in
 * Harbor's own Postgres.
 */
import { betterAuth } from "better-auth"
import { emailOTP } from "better-auth/plugins"

import { connect } from "./db.ts"
import { sendConfirmation, sendSignInCode } from "./mail.ts"
import { broken, settings } from "./settings.ts"

/** How long an emailed code works. */
export const CODE_MINUTES = 5

/** The header the API puts the caller's address in, from its own socket, for the rate limiter. */
export const CLIENT_IP_HEADER = "x-harbor-client-ip"

/**
 * How often each sensitive call may be made from one address. Asking for a code is the one an
 * attacker would hammer: three in five minutes, then 429 until the window has passed. Every read
 * (the session, the lists on the settings page) is left unlimited.
 */
const RATE_LIMITS = {
  "/email-otp/send-verification-otp": { window: 300, max: 3 },
  "/sign-in/email-otp": { window: 300, max: 10 },
  "/sign-up/email": { window: 60, max: 5 },
  "/sign-in/email": { window: 60, max: 5 },
  "/get-session": false,
  "/list-sessions": false,
  "/list-accounts": false,
} as const

export const { pool, resilient } = connect(settings.DATABASE_URL)

export const auth = betterAuth({
  appName: "Harbor",
  baseURL: settings.BETTER_AUTH_URL,
  secret: settings.BETTER_AUTH_SECRET,
  trustedOrigins: [settings.BETTER_AUTH_URL],
  database: resilient,
  telemetry: { enabled: false },
  emailAndPassword: {
    enabled: true,
    /* A password account works only once its owner has proved the address is theirs. */
    requireEmailVerification: true,
    minPasswordLength: 10,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }) {
      await sendConfirmation(user.email, user.name, url)
    },
  },
  socialProviders: {
    google: {
      clientId: settings.GOOGLE_CLIENT_ID,
      clientSecret: settings.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientId: settings.GITHUB_CLIENT_ID,
      clientSecret: settings.GITHUB_CLIENT_SECRET,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      /*
       * Signing in with Google or GitHub as someone who already has a Harbor account links the two,
       * when the provider vouches for the address. From the settings page, a signed-in person may
       * link a GitHub account under another address too: they proved both by signing in to each.
       */
      trustedProviders: ["google", "github"],
      allowDifferentEmails: true,
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: CODE_MINUTES * 60,
      /* Three wrong guesses and the code stops working, even the right one. */
      allowedAttempts: 3,
      async sendVerificationOTP({ email, otp }) {
        await sendSignInCode(email, otp, CODE_MINUTES)
      },
    }),
  ],
  rateLimit: {
    enabled: !broken("no-rate-limit"),
    /*
     * Counters live in Postgres, so every API process sees the same ones and a restart forgets
     * nothing.
     */
    storage: "database",
    window: 60,
    max: 100,
    customRules: RATE_LIMITS,
  },
  advanced: {
    ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
  },
})
