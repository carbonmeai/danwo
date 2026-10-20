import { Resend } from "resend"
import { Stripe } from "stripe"
import { describe, expect, it } from "vitest"

import { clerkWebhookHeaders } from "../src/clerk/webhooks.ts"
import { nangoWebhookHeaders } from "../src/nango/helpers.ts"
import { nylasWebhookHeaders } from "../src/nylas/events.ts"
import { pusherWebhookHeaders } from "../src/pusher/signature.ts"
import { resendWebhookHeaders } from "../src/resend/signature.ts"
import { stripeWebhookHeaders } from "../src/stripe/signature.ts"
import { forgedSecret } from "../src/webhooks.ts"

const BODY = JSON.stringify({ type: "user.updated", data: { id: "user_1" } })
const NOW = Math.floor(Date.UTC(2026, 9, 20, 19) / 1000)

/** `whsec_` secrets whose base64 ends in `=`, in `==`, and in no padding at all. */
const SVIX_SECRETS = [23, 16, 24].map((n) => `whsec_${Buffer.alloc(n, 0x5a).toString("base64")}`)
/** Secrets providers use as text: Stripe's `whsec_`, and plain ones. */
const TEXT_SECRETS = ["whsec_test_secret", "nango-secret-1", "pusher_app_secret", "Zm9vYmFy=="]

/** Each provider's signed headers for a secret, as its emulator's `sign` makes them. */
const SIGNERS: Readonly<Record<string, (secret: string) => Record<string, string>>> = {
  stripe: (secret) => stripeWebhookHeaders(secret, BODY, NOW),
  clerk: (secret) => clerkWebhookHeaders(secret, BODY, NOW),
  resend: (secret) => resendWebhookHeaders(secret, BODY, NOW),
  nylas: (secret) => nylasWebhookHeaders(secret, BODY),
  nango: (secret) => nangoWebhookHeaders(secret, BODY),
  pusher: (secret) => pusherWebhookHeaders("app-key", secret, BODY),
}

/** Verifies Svix-signed headers the way the resend SDK does; throws when they do not verify. */
function verifiedBy(secret: string, headers: Record<string, string>): unknown {
  return new Resend("re_receiver").webhooks.verify({
    payload: BODY,
    headers: {
      id: headers["webhook-id"] ?? "",
      timestamp: headers["webhook-timestamp"] ?? "",
      signature: headers["webhook-signature"] ?? "",
    },
    webhookSecret: secret,
  })
}

describe("forged webhook signatures", () => {
  it("never verify with the real Svix secret, with or without base64 padding", () => {
    /* The verifier reads the real clock, so the signature is all that can fail it. */
    const fresh = Math.floor(Date.now() / 1000)
    const signedWith = (secret: string) => resendWebhookHeaders(secret, BODY, fresh)

    for (const secret of SVIX_SECRETS) {
      expect(() => verifiedBy(secret, signedWith(secret))).not.toThrow()
      expect(() => verifiedBy(secret, signedWith(forgedSecret(secret)))).toThrow(/signature/i)
    }

    /* What the forge used to send: the decoder stops at the padding, so it verified. */
    const padded = SVIX_SECRETS[0] ?? ""

    expect(() => verifiedBy(padded, signedWith(`${padded}_forged`))).not.toThrow()
  })

  it("never verify with the real Stripe secret", () => {
    for (const secret of [...TEXT_SECRETS, ...SVIX_SECRETS]) {
      const fresh = Math.floor(Date.now() / 1000)
      const forged = stripeWebhookHeaders(forgedSecret(secret), BODY, fresh)

      expect(() =>
        Stripe.webhooks.constructEvent(BODY, forged["stripe-signature"] ?? "", secret),
      ).toThrow(/signature/i)
    }
  })

  it("sign differently from the real secret for every provider", () => {
    for (const [provider, sign] of Object.entries(SIGNERS))
      for (const secret of [...SVIX_SECRETS, ...TEXT_SECRETS])
        expect(sign(forgedSecret(secret)), `${provider} with ${secret}`).not.toEqual(sign(secret))
  })

  it("keep the secret's prefix and mark the copy", () => {
    const forged = forgedSecret("REDACTED-TEST-VALUE")

    expect(forged).toMatch(/^whsec_.+_forged$/)
    expect(Buffer.from(forged.slice(6), "base64")).not.toEqual(Buffer.from("ZGFud28=", "base64"))
  })
})
