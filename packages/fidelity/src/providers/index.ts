/** Every provider with a fidelity suite, in the order they are checked. */
import type { FidelityProvider } from "../provider.ts"
import { bachsFidelity } from "./bachs.ts"
import { bedrockFidelity } from "./bedrock.ts"
import { clerkFidelity } from "./clerk.ts"
import { composioFidelity } from "./composio.ts"
import { nangoFidelity, nylasFidelity, unipileFidelity } from "./connectors.ts"
import { flutterwaveFidelity } from "./flutterwave.ts"
import { gatewayFidelity } from "./gateway.ts"
import { geminiFidelity } from "./gemini.ts"
import { githubFidelity } from "./github.ts"
import { googleFidelity } from "./google.ts"
import { microsoftFidelity } from "./microsoft.ts"
import { novuFidelity } from "./novu.ts"
import { paystackFidelity } from "./paystack.ts"
import { perplexityFidelity } from "./perplexity.ts"
import { pusherFidelity } from "./pusher.ts"
import { resendFidelity } from "./resend.ts"
import { s3Fidelity } from "./s3.ts"
import { slackFidelity } from "./slack.ts"
import { stripeFidelity } from "./stripe.ts"
import { tiptapFidelity } from "./tiptap.ts"
import { twilioFidelity } from "./twilio.ts"

export const FIDELITY_PROVIDERS: readonly FidelityProvider[] = [
  stripeFidelity,
  resendFidelity,
  s3Fidelity,
  twilioFidelity,
  paystackFidelity,
  flutterwaveFidelity,
  bachsFidelity,
  slackFidelity,
  githubFidelity,
  googleFidelity,
  microsoftFidelity,
  gatewayFidelity,
  geminiFidelity,
  perplexityFidelity,
  bedrockFidelity,
  composioFidelity,
  nylasFidelity,
  nangoFidelity,
  unipileFidelity,
  clerkFidelity,
  pusherFidelity,
  novuFidelity,
  tiptapFidelity,
]

/** The providers named in `names`, or all of them; an unknown name is an error. */
export function providersNamed(names: readonly string[]): FidelityProvider[] {
  if (names.length === 0) return [...FIDELITY_PROVIDERS]

  return names.map((name) => {
    const provider = FIDELITY_PROVIDERS.find((candidate) => candidate.name === name)

    if (provider === undefined)
      throw new Error(
        `no fidelity suite for "${name}"; known: ${FIDELITY_PROVIDERS.map((p) => p.name).join(", ")}`,
      )

    return provider
  })
}
