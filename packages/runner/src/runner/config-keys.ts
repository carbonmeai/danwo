/**
 * Keys a config sets that danwo does not know. Node strips the config's types without checking
 * them, so `retires: 2` or `testmatch` would otherwise load and do nothing. Each unknown key is
 * named with the known key it most likely means.
 */
import type { DanwoConfig } from "./config.ts"

/** Every top-level key; the type makes a key added to `DanwoConfig` and missing here an error. */
const CONFIG_KEYS: Readonly<Record<keyof DanwoConfig, true>> = {
  testDir: true,
  testMatch: true,
  baseUrl: true,
  workers: true,
  retries: true,
  timeout: true,
  model: true,
  judge: true,
  budget: true,
  judgeScreenshot: true,
  vision: true,
  cache: true,
  secrets: true,
  files: true,
  relocate: true,
  relocation: true,
  effects: true,
  readiness: true,
  appErrors: true,
  sessions: true,
  environment: true,
  isolation: true,
  record: true,
  video: true,
  reporters: true,
  impact: true,
  lint: true,
  matrix: true,
}

const MATRIX_KEYS: Readonly<Record<keyof NonNullable<DanwoConfig["matrix"]>, true>> = {
  outboundFaults: true,
  webhookFaults: true,
  dataFaults: true,
  rerunInvalid: true,
  workers: true,
  checkPace: true,
  races: true,
  budget: true,
}

/** The edit distance between `a` and `b`, letters compared without case. */
function distance(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  let row = Array.from({ length: y.length + 1 }, (_, j) => j)

  for (let i = 1; i <= x.length; i++) {
    const next = [i]

    for (let j = 1; j <= y.length; j++) {
      const swap = x[i - 1] === y[j - 1] ? 0 : 1

      next[j] = Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + swap)
    }

    row = next
  }

  return row[y.length] ?? 0
}

/** The known key `key` is most likely a typo of, when one is close enough. */
export function closestKey(key: string, known: readonly string[]): string | undefined {
  const scored = known
    .map((name) => ({ name, score: distance(key, name) }))
    .toSorted((a, b) => a.score - b.score)
  const best = scored[0]

  return best !== undefined && best.score <= Math.max(2, Math.floor(key.length / 3))
    ? best.name
    : undefined
}

/** A warning for each key of `value` not in `known`, prefixed with where it is (`matrix.`). */
function unknownKeys(value: object, known: readonly string[], prefix: string): string[] {
  return Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => {
      const guess = closestKey(key, known)

      return `unknown config key \`${prefix}${key}\`${guess === undefined ? "" : ` (did you mean \`${prefix}${guess}\`?)`}; danwo ignores it`
    })
}

/** What is wrong with the keys `config` sets, one line each; empty when every key is known. */
export function configWarnings(config: object): string[] {
  const matrix: unknown = Reflect.get(config, "matrix")

  return [
    ...unknownKeys(config, Object.keys(CONFIG_KEYS), ""),
    ...(typeof matrix === "object" && matrix !== null
      ? unknownKeys(matrix, Object.keys(MATRIX_KEYS), "matrix.")
      : []),
  ]
}

/** Prints a loaded config's warnings on stderr, where they stay out of `--list`'s JSON. */
export function printConfigWarnings(loaded: { readonly warnings?: readonly string[] }): void {
  for (const warning of loaded.warnings ?? []) process.stderr.write(`danwo: warning: ${warning}\n`)
}
