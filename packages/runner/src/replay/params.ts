/**
 * Values an instruction names in braces (`greet "{name}"`). A plain string is part of what the
 * step means, so a different value is a different recording; a `unique()` value is fresh on every
 * run, so a recording made with one replays with the next; a secret is shown to the model by name.
 */
import { isSecret, type Secret } from "../secrets/index.ts"

const UNIQUE = Symbol.for("danwo.unique")

/** A value that differs on every run, such as a new user's email; recordings replay with the new one. */
export interface Unique {
  readonly [UNIQUE]: true
  readonly value: string
}

/** Marks `value` as fresh on every run: a recorded step replays with the value of this run. */
export function unique(value: string): Unique {
  return { [UNIQUE]: true, value }
}

function isUnique(value: unknown): value is Unique {
  return typeof value === "object" && value !== null && UNIQUE in value
}

/** One param of an `agent.act` call. */
export type ParamValue = string | Unique | Secret

export type Params = Readonly<Record<string, ParamValue>>

/** What identifies a step's params in its recording key: plain values in full, the rest by kind. */
export function paramIdentity(params: Params): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => {
        if (isSecret(value)) return [name, "secret"]
        if (isUnique(value)) return [name, "unique"]

        return [name, `text:${value}`]
      }),
  )
}

/** The params as the model sees them: values for text, a name for each secret. */
export function shownParams(params: Params): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([name, value]) => {
      if (isSecret(value)) return [name, `<secret ${value.name}>`]
      if (isUnique(value)) return [name, value.value]

      return [name, value]
    }),
  )
}

/** The param whose text value is exactly `text`, if any: a recording stores the name, not the text. */
export function paramTyped(params: Params, text: string): string | undefined {
  for (const [name, value] of Object.entries(params)) {
    if (isSecret(value)) continue
    if ((isUnique(value) ? value.value : value) === text) return name
  }

  return undefined
}

/** Values shorter than this are too common to say a text was built from them ("1", "ok"). */
const MIN_EMBEDDED_LENGTH = 3

/**
 * Whether `text` contains the value of one of `params` (or of `others`, such as values read from
 * an emulator): something recorded with it inside would not match on a run with other values.
 */
export function embedsValue(text: string, params: Params, others: readonly string[] = []): boolean {
  const values = Object.values(params).flatMap((value) => {
    if (isSecret(value)) return []

    return [isUnique(value) ? value.value : value]
  })

  return [...values, ...others].some(
    (value) => value.length >= MIN_EMBEDDED_LENGTH && text.includes(value),
  )
}

/** The text of a non-secret param, for typing it again on replay. */
export function paramText(params: Params, name: string): string | undefined {
  const value = params[name]

  if (value === undefined || isSecret(value)) return undefined

  return isUnique(value) ? value.value : value
}

/** The secret handle passed as param `name`, if it is one. */
export function paramSecret(params: Params, name: string): Secret | undefined {
  const value = params[name]

  return isSecret(value) ? value : undefined
}
