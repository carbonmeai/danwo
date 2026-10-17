import type { GraphState } from "./context.ts"
import type { ChangeRecord } from "./entities.ts"
import { notifySubscribers } from "./notifications.ts"

/** A change to record: who owns the item, what kind it is, and what happened. */
export type Change = Omit<ChangeRecord, "id" | "created_at" | "updated_at">

/** Records a change for delta queries and tells the subscriptions watching it. */
export function recordChange(state: GraphState, change: Change): void {
  const stored = state.microsoft().changes.insert(change)

  notifySubscribers(state, stored)
}

/** The position of the newest change, which a delta link starts after. */
export function latestChange(state: GraphState): number {
  return state.microsoft().changes.all().at(-1)?.id ?? 0
}

/**
 * The last change to each item of `kind` that `owner` owns, after position `since`, in the order
 * the items last changed; `where` narrows them (say, to one mail folder).
 */
export function changesSince(
  state: GraphState,
  query: {
    readonly owner: string
    readonly kind: ChangeRecord["kind"]
    readonly since: number
    readonly where?: (change: ChangeRecord) => boolean
  },
): ChangeRecord[] {
  const last = new Map<string, ChangeRecord>()

  for (const change of state.microsoft().changes.findBy("owner", query.owner))
    if (change.kind === query.kind && change.id > query.since && (query.where?.(change) ?? true)) {
      last.delete(change.targetId)
      last.set(change.targetId, change)
    }

  return [...last.values()]
}

/** Packs delta state into the opaque token a delta link carries. */
export function encodeToken(state: Readonly<Record<string, string | number>>): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url")
}

/** Unpacks a delta token, or `undefined` when it is not one this emulator issued. */
export function decodeToken(token: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))

    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : undefined
  } catch {
    return undefined
  }
}
