/**
 * Where a planned fault lands: the nth call (or socket) to one route in a run, counted as the run
 * makes them, so a call another run makes in a different order cannot shift it.
 */

/** A planned fault's place: its route, and which call to that route, from 0. */
export interface Occurrence {
  readonly route: string
  readonly occurrence: number
}

/**
 * A matcher that counts the calls it sees by route and says yes to exactly the one `planned`
 * names. Keep one per run: it remembers what it has counted.
 */
export function occurrenceOf<C>(
  routeOf: (call: C) => string,
  planned: Occurrence,
): (call: C) => boolean {
  const seen = new Map<string, number>()

  return (call) => {
    const route = routeOf(call)
    const occurrence = seen.get(route) ?? 0

    seen.set(route, occurrence + 1)

    return route === planned.route && occurrence === planned.occurrence
  }
}
