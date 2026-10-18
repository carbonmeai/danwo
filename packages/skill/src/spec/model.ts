/** The shape of danwo's capability spec: sections of entries, each read from the code. */

/** The spec's sections, in the order it prints them; `danwo spec --topic` takes one of these. */
export const SPEC_TOPICS = [
  "api",
  "fixtures",
  "locators",
  "expect",
  "agent",
  "secrets",
  "config",
  "environments",
  "emulators",
  "faults",
  "cli",
  "errors",
  "cache",
  "exports",
] as const

export type SpecTopic = (typeof SPEC_TOPICS)[number]

/** Whether `value` names one of the spec's sections. */
export function isSpecTopic(value: string): value is SpecTopic {
  return SPEC_TOPICS.some((topic) => topic === value)
}

/** A member of an entry: an interface's property or method, a command's option. */
export interface SpecMember {
  readonly name: string
  readonly signature: string
  readonly doc: string
}

/** One thing the spec describes: an export, a config key's interface, an error code, a command. */
export interface SpecEntry {
  readonly name: string
  /** `function`, `value`, `interface`, `type`, `class`, or what the section lists (`code`, `command`…). */
  readonly kind: string
  readonly signature: string
  readonly doc: string
  readonly members: readonly SpecMember[]
}

export interface SpecSection {
  readonly topic: SpecTopic
  readonly title: string
  /** One or two sentences on what the section covers and how to use it. */
  readonly about: string
  readonly entries: readonly SpecEntry[]
}

export interface Spec {
  readonly sections: readonly SpecSection[]
}

/** A command's positional argument, as the CLI defines it. */
export interface CliArgument {
  readonly name: string
  readonly required: boolean
  readonly variadic: boolean
  readonly description: string
  readonly choices: readonly string[]
}

/** A command's option, as the CLI defines it. */
export interface CliOption {
  readonly flags: string
  readonly description: string
  readonly choices: readonly string[]
  readonly default: string | undefined
}

/** One `danwo` command, as the CLI defines it; the CLI hands these to the spec. */
export interface CliCommand {
  readonly name: string
  readonly description: string
  readonly arguments: readonly CliArgument[]
  readonly options: readonly CliOption[]
}
