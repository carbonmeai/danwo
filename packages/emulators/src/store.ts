/**
 * Emulator state: named collections of records with numeric ids and timestamps, plus a few
 * free-form values. Everything can be captured as plain JSON and put back, which is how an
 * emulator resets between runs and how a failed run's state is recorded.
 */

/** Where an emulator gets the time; tests pass a fixed or manual clock. */
export type Clock = () => Date

export const systemClock: Clock = () => new Date()

/** The fields every stored record has. */
export interface Entity {
  id: number
  created_at: string
  updated_at: string
}

/** A record before it is stored: the store assigns the id (unless given) and timestamps. */
export type NewRecord<T extends Entity> = Omit<T, keyof Entity> & { id?: number }

/** One collection as captured by `Store.snapshot`. */
export interface CollectionDump {
  readonly rows: readonly Entity[]
  readonly nextId: number
}

/** A whole store as plain JSON. */
export interface StoreSnapshot {
  readonly collections: Readonly<Record<string, CollectionDump>>
  readonly values: Readonly<Record<string, unknown>>
}

/** Values are kept as given; maps and sets are tagged so a snapshot is plain JSON. */
function toJson(value: unknown): unknown {
  if (value instanceof Map) return { $map: [...value].map(([k, v]) => [toJson(k), toJson(v)]) }
  if (value instanceof Set) return { $set: [...value].map(toJson) }
  if (Array.isArray(value)) return value.map(toJson)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]))

  return value
}

function fromJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromJson)
  if (value === null || typeof value !== "object") return value

  const record = value as Record<string, unknown>

  if (Array.isArray(record.$map))
    return new Map(
      (record.$map as unknown[][]).map(([k, v]) => [fromJson(k), fromJson(v)] as const),
    )
  if (Array.isArray(record.$set)) return new Set((record.$set as unknown[]).map(fromJson))

  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, fromJson(v)]))
}

/** A set of records of one kind, with optional lookup indexes on chosen fields. */
export class Collection<T extends Entity> {
  private rows = new Map<number, T>()
  private nextId = 1
  private readonly indexes = new Map<keyof T, Map<unknown, Set<number>>>()
  private readonly clock: Clock

  constructor(clock: Clock, indexed: readonly (keyof T)[] = []) {
    this.clock = clock
    for (const field of indexed) this.indexes.set(field, new Map())
  }

  insert(fields: NewRecord<T>): T {
    const at = this.now()

    return this.put({
      ...fields,
      id: fields.id ?? this.nextId,
      created_at: at,
      updated_at: at,
    } as T)
  }

  /** Every record whose `field` equals `value`, in insertion order. */
  findBy<K extends keyof T>(field: K, value: T[K]): T[] {
    const ids = this.indexes.get(field)?.get(value)
    const wanted = ids ? (row: T) => ids.has(row.id) : (row: T) => row[field] === value

    return this.all().filter(wanted)
  }

  findOneBy<K extends keyof T>(field: K, value: T[K]): T | undefined {
    return this.findBy(field, value)[0]
  }

  /** Merges `changes` into a record and bumps `updated_at`. The id and `created_at` never change. */
  update(id: number, changes: Partial<T>): T | undefined {
    const current = this.rows.get(id)

    return (
      current &&
      this.put({
        ...current,
        ...changes,
        id,
        created_at: current.created_at,
        updated_at: this.now(),
      })
    )
  }

  delete(id: number): boolean {
    return this.remove(id) !== undefined
  }

  all(): T[] {
    return [...this.rows.values()]
  }

  // fallow-ignore-next-line unused-class-member -- called on collections that Store.collection() returns
  count(where?: (row: T) => boolean): number {
    return where ? this.all().filter(where).length : this.rows.size
  }

  clear(): void {
    this.rows.clear()
    this.nextId = 1
    for (const index of this.indexes.values()) index.clear()
  }

  dump(): CollectionDump {
    return { rows: structuredClone(this.all()), nextId: this.nextId }
  }

  // fallow-ignore-next-line unused-class-member -- called on collections that Store.collection() returns
  load(dump: CollectionDump): void {
    this.clear()

    for (const row of structuredClone(dump.rows) as T[]) {
      this.rows.set(row.id, row)
      this.index(row)
    }

    this.nextId = dump.nextId
  }

  private now(): string {
    return this.clock().toISOString()
  }

  /** Stores a record under its id, replacing any earlier version, and keeps ids increasing. */
  private put(row: T): T {
    this.remove(row.id)
    this.rows.set(row.id, row)
    this.index(row)
    this.nextId = Math.max(this.nextId, row.id + 1)

    return row
  }

  private remove(id: number): T | undefined {
    const row = this.rows.get(id)

    if (row) {
      this.unindex(row)
      this.rows.delete(id)
    }

    return row
  }

  private index(row: T): void {
    for (const [field, index] of this.indexes) {
      const ids = index.get(row[field]) ?? new Set<number>()

      ids.add(row.id)
      index.set(row[field], ids)
    }
  }

  private unindex(row: T): void {
    for (const [field, index] of this.indexes) index.get(row[field])?.delete(row.id)
  }
}

/** All of one emulator's state. */
export class Store {
  readonly clock: Clock
  private readonly collections = new Map<string, Collection<Entity>>()
  private values = new Map<string, unknown>()

  constructor(clock: Clock = systemClock) {
    this.clock = clock
  }

  /** The collection called `name`, created on first use with the given indexed fields. */
  collection<T extends Entity>(name: string, indexed: readonly (keyof T)[] = []): Collection<T> {
    let found = this.collections.get(name)

    if (!found) {
      found = new Collection<T>(this.clock, indexed) as unknown as Collection<Entity>
      this.collections.set(name, found)
    }

    return found as unknown as Collection<T>
  }

  getData<V>(key: string): V | undefined {
    return this.values.get(key) as V | undefined
  }

  setData(key: string, value: unknown): void {
    this.values.set(key, value)
  }

  /** Empties every collection and value; collections keep their indexes. */
  reset(): void {
    for (const collection of this.collections.values()) collection.clear()
    this.values = new Map()
  }

  snapshot(): StoreSnapshot {
    return {
      collections: Object.fromEntries(
        [...this.collections].map(([name, collection]) => [name, collection.dump()]),
      ),
      values: Object.fromEntries([...this.values].map(([key, value]) => [key, toJson(value)])),
    }
  }

  restore(snapshot: StoreSnapshot): void {
    this.reset()
    for (const [name, dump] of Object.entries(snapshot.collections))
      this.collection(name).load(dump)
    this.values = new Map(
      Object.entries(snapshot.values).map(([key, value]) => [key, fromJson(value)]),
    )
  }
}
