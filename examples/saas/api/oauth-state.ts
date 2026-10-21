/**
 * The `state` of an OAuth round trip: which workspace and person started it, and for Google the
 * PKCE verifier, sealed (encrypted and signed) with Relay's secret. The callback can't be pointed
 * at someone else's workspace, a stale link stops working, and the verifier never shows in a URL.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

import { z } from "zod"

import { HttpError } from "./problems.ts"
import { settings } from "./settings.ts"

const State = z.object({
  workspaceId: z.string(),
  userId: z.string(),
  provider: z.enum(["slack", "google"]),
  /** The PKCE code verifier the token exchange must send. */
  verifier: z.string().optional(),
  issuedAt: z.number(),
})

type State = z.infer<typeof State>

/** How long a connect link stays good. */
const STATE_MS = 15 * 60_000

const KEY = createHash("sha256").update(settings.STATE_SECRET).digest()

/** A sealed state for a connect link. */
export function sealState(state: Omit<State, "issuedAt">): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", KEY, iv)
  const sealed = Buffer.concat([
    cipher.update(JSON.stringify({ ...state, issuedAt: Date.now() })),
    cipher.final(),
  ])

  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64url")
}

/** The state a callback carried, opened and checked: Relay's, recent, for this provider and person. */
export function openState(raw: string, provider: State["provider"], userId: string): State {
  let state: State

  try {
    const bytes = Buffer.from(raw, "base64url")
    const decipher = createDecipheriv("aes-256-gcm", KEY, bytes.subarray(0, 12))

    decipher.setAuthTag(bytes.subarray(12, 28))
    state = State.parse(
      JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString()),
    )
  } catch {
    throw new HttpError(400, "That link isn't valid. Start connecting again.")
  }

  if (state.provider !== provider || state.userId !== userId)
    throw new HttpError(400, "That link was for someone else. Start connecting again.")
  if (Date.now() - state.issuedAt > STATE_MS)
    throw new HttpError(400, "That link has expired. Start connecting again.")

  return state
}
