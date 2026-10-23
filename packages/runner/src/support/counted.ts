/** A count with its noun, singular for one: `1 worker`, `2 workers`, `0 tests`. */
export function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}
