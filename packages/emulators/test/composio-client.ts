import { Composio } from "@composio/core"

import { composio, type ComposioSeedConfig, seedComposio } from "../src/composio/index.ts"
import { createEmulator, type Emulator, type EmulatorOptions } from "../src/define.ts"

/** Test helpers for the Composio emulator: an emulator, the official SDK pointed at it. */

export const API_KEY = "ak_danwo_test_key"
export const API = "https://backend.composio.dev/api/v3.1"

/** A Composio emulator with `seed` loaded. */
export function composioWith(
  seed: ComposioSeedConfig = {},
  options: EmulatorOptions = {},
): Emulator {
  const emulator = createEmulator(composio, options)

  seedComposio(emulator.store, seed)

  return emulator
}

/** Routes requests by host: to the emulator answering it, as danwo's proxy does. */
export type Router = (request: Request) => Promise<Response>

export function router(routes: Readonly<Record<string, Emulator>>): Router {
  return async (request) => {
    const host = new URL(request.url).hostname
    const target = routes[host]

    if (!target) return new Response(`no emulator for ${host}`, { status: 502 })

    return target.fetch(request)
  }
}

/**
 * The official SDK with every request it makes sent through `route`. The SDK reads the global
 * fetch when it sends, so it is replaced for the test and put back by `restore`.
 */
export function sdk(
  route: Router,
  warnings: string[] = [],
): { readonly client: Composio; restore(): void } {
  const original = globalThis.fetch

  globalThis.fetch = async (input, init) =>
    route(new Request(input, { ...init, ...(init?.body && { duplex: "half" }) }))

  return {
    client: new Composio({
      apiKey: API_KEY,
      allowTracking: false,
      logger: {
        error: (...args: unknown[]) => void warnings.push(textOf(args)),
        warn: (...args: unknown[]) => void warnings.push(textOf(args)),
        info: () => undefined,
        debug: () => undefined,
      },
    }),
    restore: () => {
      globalThis.fetch = original
    },
  }
}

/** A log call's arguments as one line. */
function textOf(args: readonly unknown[]): string {
  return args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")
}

/** Warnings the SDK logged because a response failed its own schema. */
export function schemaWarnings(warnings: readonly string[]): string[] {
  return warnings.filter((warning) => warning.includes("validation failed"))
}

/** A JSON API call to the emulator with the test key. */
export async function call(
  emulator: Emulator,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await emulator.fetch(
    new Request(`${API}${path}`, {
      method,
      headers: {
        "x-api-key": API_KEY,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
  )
  const parsed: unknown = await response.json()

  return {
    status: response.status,
    body: typeof parsed === "object" && parsed !== null ? { ...parsed } : { value: parsed },
  }
}

/** Follows redirects through `route`, posting `form` on any page that asks for one, until it leaves the emulators. */
export async function follow(
  route: Router,
  url: string,
  answer: (
    page: string,
    url: string,
  ) => { readonly action: string; readonly form: Record<string, string> } | undefined,
): Promise<string> {
  let next = new Request(url)

  for (let hop = 0; hop < 12; hop++) {
    const response = await route(next)
    const location = response.headers.get("location")

    if (location) {
      const target = new URL(location, next.url)

      if (target.hostname.endsWith(".test")) return target.toString()

      next = new Request(target)
      continue
    }

    const page = await response.text()
    const step = answer(page, next.url)

    if (!step) throw new Error(`stuck on ${next.url} (${response.status}): ${page.slice(0, 200)}`)

    next = new Request(new URL(step.action, next.url), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(step.form),
    })
  }

  throw new Error("too many redirects")
}
