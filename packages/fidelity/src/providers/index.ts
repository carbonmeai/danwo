/** Every provider with a fidelity suite, in the order they are checked. */
import type { FidelityProvider } from "../provider.ts"
import { resendFidelity } from "./resend.ts"
import { stripeFidelity } from "./stripe.ts"

export const FIDELITY_PROVIDERS: readonly FidelityProvider[] = [stripeFidelity, resendFidelity]

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
