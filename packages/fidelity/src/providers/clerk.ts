/**
 * Clerk's fidelity suite: the Backend API (users, organizations, sessions, signing keys, errors)
 * and the Frontend API a browser drives (sign-up and sign-in by emailed code), against a
 * development instance only. Live runs use Clerk's test addresses, so no mail is sent, and delete
 * every user and organization they make.
 */
import { clerk, clerkInstance, createEmulator, seedClerk } from "@danwo/emulators"

import { type FidelityProvider, refuseLive, requiredCredentials } from "../provider.ts"
import { liveTarget } from "../target.ts"
import { CLERK_BACKEND_SCENARIOS } from "./clerk-backend.ts"
import { CLERK_FRONTEND_SCENARIOS } from "./clerk-frontend.ts"

const SECRET = "DANWO_FIDELITY_CLERK_SECRET_KEY"
const PUBLISHABLE = "DANWO_FIDELITY_CLERK_PUBLISHABLE_KEY"

export const clerkFidelity: FidelityProvider = {
  name: "clerk",
  credentials: [
    { name: SECRET, description: "a development instance's secret key (sk_test_…)" },
    { name: PUBLISHABLE, description: "the same instance's publishable key (pk_test_…)" },
  ],
  scenarios: [...CLERK_BACKEND_SCENARIOS, ...CLERK_FRONTEND_SCENARIOS],
  emulator() {
    const emulator = createEmulator(clerk)

    /* The check's development instance signs in by emailed code, with no password. */
    seedClerk(emulator.store, { instance: { password: false } })

    const { secretKey, publishableKey } = clerkInstance(emulator).instance

    return Promise.resolve({
      kind: "emulator",
      credentials: { key: secretKey, publishable: publishableKey },
      send: (request) => emulator.fetch(request),
      close: () => emulator.close(),
    })
  },
  live(env) {
    const found = requiredCredentials(this, env)
    const key = found?.[SECRET]
    const publishable = found?.[PUBLISHABLE]

    if (key === undefined || publishable === undefined) return undefined

    refuseLive("Clerk", SECRET, key, [/^(?!sk_test_)/])
    refuseLive("Clerk", PUBLISHABLE, publishable, [/^(?!pk_test_)/])

    return liveTarget({ key, publishable })
  },
}
