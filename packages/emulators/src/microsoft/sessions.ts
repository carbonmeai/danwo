import type { MicrosoftStore } from "./store.ts"

/**
 * Revokes every token a user holds, in every app: their refresh tokens stop working (the token
 * endpoint answers `invalid_grant`, AADSTS50173) and Graph refuses their access tokens.
 */
export function revokeSessions(microsoft: MicrosoftStore, oid: string): number {
  const held = microsoft.tokens.all().filter((t) => t.user === oid && !t.revoked)

  for (const token of held) microsoft.tokens.update(token.id, { revoked: true })

  return held.length
}
