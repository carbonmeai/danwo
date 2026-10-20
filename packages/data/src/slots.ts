/**
 * The slots a data snapshot keeps. An environment with `snapshotSlots` keeps several states at
 * once (the seeded one, a file's setup, a saved session signed in) and names each; a snapshot
 * numbers the names in the order it first meets them, so the copies it keeps (template databases,
 * schemas, files) get short names. A `snapshot()` or `restore()` called without a slot keeps slot
 * 0, under the names a single snapshot always had.
 */
export class SnapshotSlots {
  readonly #numbers = new Map<string, number>()

  /** The number of `slot`, given one the first time it is named; no slot is 0. */
  number(slot?: string): number {
    if (slot === undefined) return 0

    const known = this.#numbers.get(slot)

    if (known !== undefined) return known

    const next = this.#numbers.size + 1

    this.#numbers.set(slot, next)

    return next
  }

  /** The number of `slot`, which a snapshot kept; an error for one never named, as a restore needs. */
  kept(slot?: string): number {
    const n = slot === undefined ? 0 : this.#numbers.get(slot)

    if (n === undefined) throw new Error(`restore("${slot}") before snapshot("${slot}")`)

    return n
  }

  /** Every slot number given so far, 0 included. */
  all(): number[] {
    return [0, ...this.#numbers.values()]
  }
}
