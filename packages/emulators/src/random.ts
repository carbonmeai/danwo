import { randomInt } from "node:crypto"

/** `length` characters drawn evenly from `alphabet`, for a provider-style id. */
export function randomChars(alphabet: string, length: number): string {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("")
}
