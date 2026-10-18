import type { SigningKey } from "../oauth/jwt.ts"
import type { Outbox } from "../outbox.ts"
import type { Clock, Store } from "../store.ts"
import { INSTANCE, type ClerkInstance, type ClerkStore } from "./store.ts"

/** What Clerk's routes share: the tables, the clocks and the instance's signing key. */
export interface ClerkContext {
  readonly clerk: ClerkStore
  readonly store: Store
  readonly outbox: Outbox
  /** The emulator's clock: records' timestamps and expiries. */
  readonly clock: Clock
  /** Real time as apps see it: session token `iat`/`exp`, which apps check with their own clock. */
  readonly wallClock: Clock
  readonly key: SigningKey
}

/** Each emulator's context, by its store, so helpers handed only the emulator can reach it. */
const CONTEXTS = new WeakMap<Store, ClerkContext>()

/** Remembers an emulator's context under its store. */
export function registerContext(context: ClerkContext): ClerkContext {
  CONTEXTS.set(context.store, context)

  return context
}

/** The context of the Clerk emulator that owns `store`. */
export function contextOf(store: Store): ClerkContext {
  const context = CONTEXTS.get(store)

  if (!context) throw new Error("this store does not belong to a Clerk emulator")

  return context
}

/** The instance the emulator plays. */
export function instanceOf(context: { readonly store: Store }): ClerkInstance {
  const instance = context.store.getData(INSTANCE)

  if (!instance) throw new Error("the Clerk emulator has no instance; seed one with seedClerk")

  return instance
}

/** Milliseconds since the epoch on the emulator's clock, as Clerk stamps its records. */
export function now(context: ClerkContext): number {
  return context.clock().getTime()
}
