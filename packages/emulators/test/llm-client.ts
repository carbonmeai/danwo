import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { Emulator } from "../src/define.ts"

export const OPENAI_KEY = "sk-test-danwo-emulated-0000000000"
export const ANTHROPIC_KEY = "REDACTED-TEST-VALUE"

/**
 * A fetch the official clients use, answered by the emulator in-process. With `behaviour`, every
 * request carries the header the proxy adds when the fault matrix asks the emulator to misbehave.
 */
export function emulatorFetch(emulator: Pick<Emulator, "fetch">, behaviour?: string): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)

    if (behaviour !== undefined) request.headers.set("x-danwo-emulate", behaviour)

    return emulator.fetch(request)
  }
}

export function openaiClient(emulator: Pick<Emulator, "fetch">, behaviour?: string): OpenAI {
  return new OpenAI({
    apiKey: OPENAI_KEY,
    fetch: emulatorFetch(emulator, behaviour),
    maxRetries: 0,
  })
}

export function anthropicClient(emulator: Pick<Emulator, "fetch">, behaviour?: string): Anthropic {
  return new Anthropic({
    apiKey: ANTHROPIC_KEY,
    fetch: emulatorFetch(emulator, behaviour),
    maxRetries: 0,
  })
}

/** A fetch that answers every call with one fixed response, as a status fault at the proxy does. */
export function faultFetch(fault: {
  readonly status: number
  readonly body: string
  readonly headers: Record<string, string>
}): typeof fetch {
  return async () => new Response(fault.body, { status: fault.status, headers: fault.headers })
}
