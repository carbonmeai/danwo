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

/** The value at `path` inside a JSON answer. */
function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      current !== null && typeof current === "object" ? Reflect.get(current, key) : undefined,
    value,
  )
}

/**
 * ClerkJS's side of the Frontend API on `emulator`, from an app at `origin`: form bodies, the dev
 * browser in the query, as ClerkJS sends them.
 */
export function frontend(emulator: Emulator, origin: string) {
  const host = `https://${clerkInstance(emulator).instance.frontendApi}`

  const call = async (
    path: string,
    options: { method?: string; devBrowser?: string; form?: Record<string, string> } = {},
  ) => {
    const url = new URL(path, host)

    if (options.devBrowser !== undefined) url.searchParams.set("__clerk_db_jwt", options.devBrowser)

    const response = await emulator.fetch(
      new Request(url, {
        method: options.method ?? "GET",
        headers: { origin, "content-type": "application/x-www-form-urlencoded" },
        ...(options.form && { body: new URLSearchParams(options.form).toString() }),
      }),
    )
    const body: unknown = await response.json()

    return { status: response.status, body }
  }

  return {
    call,
    at,
    /** A new dev browser, as ClerkJS makes on its first load. */
    devBrowser: async () =>
      String(at((await call("/v1/dev_browser", { method: "POST" })).body, "id")),
  }
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
