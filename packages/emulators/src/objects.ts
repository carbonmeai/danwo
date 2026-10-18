// fallow-ignore-file unused-class-member -- tables are reached through typed object maps fallow cannot follow
import type { Collection, Entity, Store } from "./store.ts"

/**
 * One API object as a provider returns it, keyed by the provider's own id. `extra` holds what
 * the emulator needs to remember about it but the API does not show.
 */
export interface ObjectRow<T, X = null> extends Entity {
  key: string
  object: T
  extra: X
}

/** API objects of one kind, addressed by their provider ids. */
export class ObjectTable<T extends object, X = null> {
  private readonly rows: Collection<ObjectRow<T, X>>
  private readonly keyOf: (object: T) => string

  constructor(rows: Collection<ObjectRow<T, X>>, keyOf: (object: T) => string) {
    this.rows = rows
    this.keyOf = keyOf
  }

  add(object: T, extra: X): T {
    this.rows.insert({ key: this.keyOf(object), object, extra })

    return object
  }

  get(id: string): T | undefined {
    return this.row(id)?.object
  }

  extra(id: string): X | undefined {
    return this.row(id)?.extra
  }

  /** Replaces what the emulator remembers about an object; false when there is no such object. */
  setExtra(id: string, extra: X): boolean {
    const row = this.row(id)

    return row !== undefined && this.rows.update(row.id, { extra }) !== undefined
  }

  /** Applies `changes` to the stored object and returns the new version. */
  change(id: string, changes: Partial<T>): T | undefined {
    const row = this.row(id)

    if (!row) return undefined

    const object = { ...row.object, ...changes }

    this.rows.update(row.id, { object })

    return object
  }

  remove(id: string): boolean {
    const row = this.row(id)

    return row !== undefined && this.rows.delete(row.id)
  }

  /** Every object, oldest first. */
  all(): T[] {
    return this.rows.all().map((row) => row.object)
  }

  where(test: (object: T) => boolean): T[] {
    return this.all().filter(test)
  }

  private row(id: string): ObjectRow<T, X> | undefined {
    return this.rows.findOneBy("key", id)
  }
}

/** The table of `name` objects in `store`, addressed by their `id`. */
export function objectTable<T extends { id: string }, X = null>(
  store: Store,
  name: string,
): ObjectTable<T, X> {
  return new ObjectTable(store.collection<ObjectRow<T, X>>(name, ["key"]), (object) => object.id)
}

/** The table of `name` objects in `store`, for providers that call their ids `sid`. */
export function sidTable<T extends { sid: string }, X = null>(
  store: Store,
  name: string,
): ObjectTable<T, X> {
  return new ObjectTable(store.collection<ObjectRow<T, X>>(name, ["key"]), (object) => object.sid)
}
