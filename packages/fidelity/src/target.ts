/** Targets: the emulator in process, or the provider's sandbox over the network. */
import { createEmulator, type Emulator, type EmulatorDefinition } from "@danwo/emulators"

import { sendLive } from "./provider.ts"
import type { OpenTarget, Target } from "./scenario.ts"

/**
 * A fresh emulator answering requests addressed to the provider's real hostnames, seeded by
 * `seed` with whatever the scenarios assume exists (a phone number, a public repository).
 */
export function emulatorTarget(
  definition: EmulatorDefinition,
  credentials: Readonly<Record<string, string>>,
  seed?: (emulator: Emulator) => void,
): Promise<OpenTarget> {
  const emulator = createEmulator(definition)

  seed?.(emulator)

  return Promise.resolve({
    kind: "emulator",
    credentials,
    send: (request) => emulator.fetch(request),
    close: () => emulator.close(),
  })
}

/** The provider's sandbox, called with `credentials`. */
export function liveTarget(credentials: Readonly<Record<string, string>>): Target {
  return { kind: "live", credentials, send: sendLive }
}

/** The value of `name` in a target's credentials; a scenario bug when it is missing. */
export function credential(target: Target, name: string): string {
  const value = target.credentials[name]

  if (value === undefined) throw new Error(`the target has no ${name}`)

  return value
}

/** A request authorized with the target's `key` as a bearer token, with an optional JSON body. */
export function bearerRequest(
  target: Target,
  method: string,
  url: string,
  body?: unknown,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request(url, {
    method,
    headers: {
      authorization: `Bearer ${credential(target, "key")}`,
      ...(body !== undefined && { "content-type": "application/json" }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  })
}

/** Adds `value` under `key` to `pairs`, nesting objects and arrays the way Stripe reads forms. */
function addFormValue(pairs: [string, string][], key: string, value: unknown): void {
  if (value === undefined || value === null) return

  if (Array.isArray(value)) {
    value.forEach((item, index) => addFormValue(pairs, `${key}[${index}]`, item))

    return
  }

  if (typeof value === "object") {
    for (const [child, nested] of Object.entries(value))
      addFormValue(pairs, `${key}[${child}]`, nested)

    return
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    pairs.push([key, String(value)])
}

/** Stripe-style form encoding: nested objects as `a[b][c]`, arrays as `a[0]`. */
export function formBody(values: Readonly<Record<string, unknown>>): string {
  const pairs: [string, string][] = []

  for (const [key, value] of Object.entries(values)) addFormValue(pairs, key, value)

  return new URLSearchParams(pairs).toString()
}
