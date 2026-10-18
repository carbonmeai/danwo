/**
 * Embeddings that are the same for the same text every time: each vector is drawn from a digest of
 * the text and scaled to unit length, so similarity search in an app behaves consistently.
 */
import { createHash } from "node:crypto"

/** The usual width of a model's vectors, when the call names no `dimensions`. */
export function defaultDimensions(model: string): number {
  return model.includes("large") ? 3072 : 1536
}

/** A unit vector of `size` numbers for `text`. */
export function embed(text: string, size: number): number[] {
  const values: number[] = []

  for (let block = 0; values.length < size; block++) {
    const digest = createHash("sha256").update(`${block}:${text}`).digest()

    for (let at = 0; at + 4 <= digest.length && values.length < size; at += 4)
      values.push(digest.readInt32BE(at) / 2 ** 31)
  }

  const length = Math.hypot(...values) || 1

  return values.map((value) => value / length)
}

/** The texts an embeddings call asks about: one string or a list of them. */
export function inputsOf(input: unknown): string[] {
  if (typeof input === "string") return [input]

  return Array.isArray(input)
    ? input.map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    : []
}
