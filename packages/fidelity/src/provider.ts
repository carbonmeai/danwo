/**
 * A provider's fidelity suite: its scenarios, how to reach its emulator, and how to reach its
 * sandbox with credentials that must never be live ones.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { OpenTarget, Scenario, Target } from "./scenario.ts"
import type { Leftover } from "./sweep.ts"

/** An environment variable a provider's live run reads. */
export interface CredentialVariable {
  readonly name: string
  readonly description: string
  /** Optional variables refine a run (a test bucket, a workspace) but are not needed to start one. */
  readonly optional?: boolean
}

/** Raised when a credential looks like a production one: fidelity only ever talks to sandboxes. */
export class LiveCredentialRefused extends Error {
  // fallow-ignore-next-line unused-class-member -- read by the CLI's exit code for errors, by name
  readonly code = "CONFIG_INVALID"

  constructor(provider: string, variable: string) {
    super(
      `${variable} looks like a live ${provider} credential; fidelity runs only with test or sandbox credentials`,
    )
    this.name = "LiveCredentialRefused"
  }
}

export interface FidelityProvider {
  readonly name: string
  /** Variables a live run reads, the required ones first. */
  readonly credentials: readonly CredentialVariable[]
  readonly scenarios: readonly Scenario[]
  /** The provider's published API description, for `danwo fidelity --from-openapi`. */
  readonly openapi?: string
  /** The description does not mark nullable fields, so any property may be null. */
  readonly openapiLooseNulls?: boolean
  /**
   * What a live run leaves in the sandbox that no API can remove, or that nothing is ever left;
   * printed by `--sweep` for a provider with nothing to sweep.
   */
  readonly leaves?: string
  /** Finds what earlier live runs left in the sandbox, for `danwo fidelity --sweep`. */
  sweep?(target: Target): Promise<readonly Leftover[]>
  /** A fresh emulator to run the scenarios against. */
  emulator(): Promise<OpenTarget>
  /**
   * The provider's sandbox, or undefined when its required variables are not all set. Throws
   * {@link LiveCredentialRefused} for a credential that looks live.
   */
  live(env: Readonly<Record<string, string | undefined>>): Target | undefined
}

/** The variables a provider needs, read from `env`, or undefined when a required one is missing. */
export function requiredCredentials(
  provider: Pick<FidelityProvider, "credentials">,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> | undefined {
  const found = Object.fromEntries(
    provider.credentials.flatMap((variable) => {
      const value = env[variable.name]?.trim()

      return value === undefined || value === "" ? [] : [[variable.name, value]]
    }),
  )
  const missing = provider.credentials.some(
    (variable) => variable.optional !== true && !(variable.name in found),
  )

  return missing ? undefined : found
}

/**
 * The opt-in for suites that call a provider's public endpoints (sign-in discovery documents,
 * signing keys, a public repository): they need no key, but a plain run stays off the network.
 */
export const PUBLIC_ENDPOINTS: CredentialVariable = {
  name: "DANWO_FIDELITY_PUBLIC",
  description: "set to 1 to call public endpoints that need no key",
}

/** Whether `env` opts in to calling public endpoints. */
export function publicEndpointsAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  return env[PUBLIC_ENDPOINTS.name]?.trim() === "1"
}

/** Refuses `value` when it matches any of `livePatterns`. */
export function refuseLive(
  provider: string,
  variable: string,
  value: string,
  livePatterns: readonly RegExp[],
): void {
  if (livePatterns.some((pattern) => pattern.test(value)))
    throw new LiveCredentialRefused(provider, variable)
}

/** Sends a request with the platform's fetch: the live target's transport. */
export function sendLive(request: Request): Promise<Response> {
  return fetch(request)
}

/** The `NAME=value` lines of an env file in `cwd`, or nothing when there is no such file. */
function envFile(cwd: string, name: string): Record<string, string> {
  const values: Record<string, string> = {}

  try {
    for (const line of readFileSync(join(cwd, name), "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)

      if (match?.[1] !== undefined && match[2] !== undefined)
        values[match[1]] = match[2].replace(/^["']|["']$/g, "")
    }
  } catch {
    /* No file: nothing from it. */
  }

  return values
}

/**
 * The process environment over `.env.fidelity` over `.env`, all from `cwd` when present. The files
 * hold sandbox credentials and stay out of git; `.env` is read for the keys a project already
 * keeps there, such as its AI Gateway key.
 */
export function fidelityEnvironment(cwd: string): Record<string, string | undefined> {
  return { ...envFile(cwd, ".env"), ...envFile(cwd, ".env.fidelity"), ...process.env }
}
