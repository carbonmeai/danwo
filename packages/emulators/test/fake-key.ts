/**
 * A fake provider key put together from its parts at runtime, so the source holds no literal that a
 * secret scanner takes for a real credential. Pass the provider's prefix apart from the body.
 */
export function fakeKey(...parts: string[]): string {
  return parts.join("")
}
