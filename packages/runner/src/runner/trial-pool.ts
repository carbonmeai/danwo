/**
 * How `danwo matrix` hands out its faulted trials: as many at once as there are workers, in plan
 * order or a shuffled one, and no new ones once enough have failed. Results keep the plan's order
 * whatever order the trials ran in, so a shuffled run reads the same as an ordered one.
 */
import { createHash } from "node:crypto"

export interface PoolOptions {
  /** Trials running at once: the crew's size. */
  readonly size: number
  /** The order to start items in, as indexes into the items; plan order when absent. */
  readonly order?: readonly number[]
  /** Starts no new item once this many finished items failed. */
  readonly stopAfter?: number
}

/**
 * Runs `work` on every item, at most `options.size` at a time; returns each item's result in the
 * items' order, `undefined` for an item never started because the run stopped early.
 */
export async function runPool<I, O>(
  items: readonly I[],
  work: (item: I) => Promise<O>,
  failed: (result: O) => boolean,
  options: PoolOptions,
): Promise<(O | undefined)[]> {
  const results: (O | undefined)[] = Array.from({ length: items.length })
  const queue = [...(options.order ?? items.keys())]
  let failures = 0

  const lane = async () => {
    for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
      if (options.stopAfter !== undefined && failures >= options.stopAfter) return

      const item = items[index]

      if (item === undefined) continue

      const result = await work(item)

      results[index] = result
      if (failed(result)) failures++
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, options.size) }, lane))

  return results
}

/**
 * A repeatable shuffle of `0..count-1` from `seed`, so a shuffled run can be run again: each index
 * is ranked by a digest of the seed and the index, and the ranks give the order.
 */
export function shuffledOrder(count: number, seed: number): number[] {
  const rank = (index: number) =>
    createHash("sha256").update(`${seed}:${index}`).digest().readUInt32BE(0)

  return Array.from({ length: count }, (_, index) => ({ index, rank: rank(index) }))
    .toSorted((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.index)
}
