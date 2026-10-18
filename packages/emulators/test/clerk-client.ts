import { createClerkClient } from "@clerk/backend"
import { vi } from "vitest"

import {
  clerk,
  CLERK_HOSTS,
  clerkInstance,
  seedClerk,
  type ClerkSeedConfig,
} from "../src/clerk/index.ts"
import { createEmulator, type Emulator } from "../src/define.ts"

/** Whether a URL is one of the hosts the Clerk emulator answers. */
function clerkHost(url: string): boolean {
  const host = new URL(url).hostname

  return CLERK_HOSTS.some((pattern) =>
    pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern,
  )
}

/**
 * A seeded Clerk emulator with the global fetch pointed at it for Clerk's hosts, as the proxy
 * routes an app's calls; `@clerk/backend` uses the global fetch under test.
 */
export function clerkTestbed(config: ClerkSeedConfig = {}) {
  const emulator: Emulator = createEmulator(clerk)
  const real = globalThis.fetch

  seedClerk(emulator.store, config)
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)

    return clerkHost(request.url) ? emulator.fetch(request) : real(request)
  })

  const { secretKey, publishableKey } = clerkInstance(emulator).instance

  return {
    emulator,
    secretKey,
    publishableKey,
    client: createClerkClient({ secretKey, publishableKey }),
    close() {
      vi.unstubAllGlobals()
    },
  }
}
