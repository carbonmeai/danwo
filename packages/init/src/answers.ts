/**
 * The choices `danwo init` acts on, whether a person made them at the prompts or a coding agent
 * passed them as flags: the detected defaults, overridden by whatever was given.
 */
import {
  AGENTS,
  type AgentId,
  type Browser,
  BROWSERS,
  DEFAULT_COMPATIBLE_URL,
  type Engine,
  ENGINES,
  isOneOf,
  MODEL_SOURCE_INFO,
  MODEL_SOURCES,
  type ModelSourceId,
  PROVIDER_IDS,
  type ProviderId,
} from "./catalog.ts"
import { type Detection, sourceWithKey } from "./detect.ts"

export interface Answers {
  readonly engine: Engine
  readonly modelSource: ModelSourceId
  /** The model id; undefined with no model source. */
  readonly model: string | undefined
  /** For an OpenAI-compatible endpoint: where it answers. */
  readonly baseUrl: string | undefined
  /** For an OpenAI-compatible endpoint: the variable holding its key, when it takes one. */
  readonly keyEnv: string | undefined
  readonly providers: readonly ProviderId[]
  readonly agents: readonly AgentId[]
  /** Register danwo's MCP server with the chosen agents. */
  readonly mcp: boolean
  /** Install the packages the files import. */
  readonly install: boolean
  /** The command that starts the app, and where it answers. */
  readonly devCommand: string
  readonly appUrl: string
  /** Replace a `danwo.config.ts` that differs from the one these answers write. */
  readonly replaceConfig: boolean
  /** The Android Virtual Device mobile tests boot, when this machine has one. */
  readonly avd: string | undefined
  /** The browsers web tests run in, each test once in each; Chromium alone by default. */
  readonly browsers: readonly Browser[]
}

/** `danwo init`'s flags, as the CLI parses them. */
export interface InitFlags {
  readonly yes?: boolean
  readonly engine?: string
  readonly modelSource?: string
  readonly model?: string
  readonly baseUrl?: string
  readonly keyEnv?: string
  readonly providers?: string
  readonly skills?: string
  readonly mcp?: boolean
  readonly skipInstall?: boolean
  readonly devCommand?: string
  readonly appUrl?: string
  readonly force?: boolean
  /** `--browser`: the browsers web tests run in, as `chromium,firefox`. */
  readonly browser?: string
}

/** A flag value `danwo init` cannot use; the message says what it takes. */
export class InitUsageError extends Error {
  override readonly name = "InitUsageError"
}

/** The engine a project most likely wants: Android for an Expo app, a browser otherwise. */
export function defaultEngine(detection: Pick<Detection, "framework">): Engine {
  return detection.framework.id === "expo" ? "mobile" : "web"
}

/** The model source whose key is already set, else the AI Gateway. */
function defaultModelSource(detection: Pick<Detection, "envNames">): ModelSourceId {
  return sourceWithKey(detection) ?? "gateway"
}

/** The agents whose folders the project has; Claude Code and the shared folder when it has none. */
export function defaultAgents(detection: Pick<Detection, "agents">): readonly AgentId[] {
  return detection.agents.length > 0 ? detection.agents : ["claude", "agents"]
}

/** The answers that need nothing from anyone. */
export function defaultAnswers(detection: Detection): Answers {
  const modelSource = defaultModelSource(detection)

  return {
    engine: defaultEngine(detection),
    modelSource,
    model: MODEL_SOURCE_INFO[modelSource].model,
    baseUrl: undefined,
    keyEnv: undefined,
    providers: detection.providers,
    agents: defaultAgents(detection),
    mcp: true,
    install: true,
    devCommand: detection.devCommand,
    appUrl: detection.appUrl,
    replaceConfig: false,
    avd: undefined,
    browsers: ["chromium"],
  }
}

/** A comma-separated list of `choices`, or `none` for an empty one. */
export function parseList<T extends string>(
  flag: string,
  value: string,
  choices: readonly T[],
): T[] {
  if (value.trim() === "none") return []

  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  const unknown = items.filter((item) => !isOneOf(choices, item))

  if (unknown.length > 0)
    throw new InitUsageError(
      `${flag}: unknown ${unknown.join(", ")}; choose from ${choices.join(", ")}, or none`,
    )

  return [...new Set(items)].filter((item) => isOneOf(choices, item))
}

function oneOf<T extends string>(flag: string, value: string, choices: readonly T[]): T {
  if (!isOneOf(choices, value))
    throw new InitUsageError(`${flag}: ${value} is not one of ${choices.join(", ")}`)

  return value
}

function checkUrl(flag: string, value: string): string {
  if (!URL.canParse(value)) throw new InitUsageError(`${flag}: ${value} is not a URL`)

  return value
}

/** The model settings `flags` ask for, over the defaults for their source. */
function modelFrom(
  flags: InitFlags,
  base: Answers,
): Pick<Answers, "modelSource" | "model" | "baseUrl" | "keyEnv"> {
  const modelSource =
    flags.modelSource === undefined
      ? base.modelSource
      : oneOf("--model-source", flags.modelSource, MODEL_SOURCES)
  const compatible = modelSource === "openai-compatible"

  return {
    modelSource,
    model:
      modelSource === "none" ? undefined : (flags.model ?? MODEL_SOURCE_INFO[modelSource].model),
    baseUrl: compatible
      ? checkUrl("--base-url", flags.baseUrl ?? DEFAULT_COMPATIBLE_URL)
      : undefined,
    keyEnv: compatible ? flags.keyEnv : undefined,
  }
}

/** The answers `flags` give, with the detected defaults for everything they leave out. */
export function answersFromFlags(detection: Detection, flags: InitFlags): Answers {
  const base = defaultAnswers(detection)

  return {
    ...base,
    ...modelFrom(flags, base),
    engine: flags.engine === undefined ? base.engine : oneOf("--engine", flags.engine, ENGINES),
    providers:
      flags.providers === undefined
        ? base.providers
        : parseList("--providers", flags.providers, PROVIDER_IDS),
    agents: flags.skills === undefined ? base.agents : parseList("--skills", flags.skills, AGENTS),
    mcp: flags.mcp ?? base.mcp,
    install: flags.skipInstall !== true,
    devCommand: flags.devCommand ?? base.devCommand,
    appUrl: flags.appUrl === undefined ? base.appUrl : checkUrl("--app-url", flags.appUrl),
    replaceConfig: flags.force === true,
    browsers: flags.browser === undefined ? base.browsers : browsersFrom(flags.browser),
  }
}

/** The browsers `--browser` names; at least one. */
function browsersFrom(value: string): Browser[] {
  const browsers = parseList("--browser", value, BROWSERS)

  if (browsers.length === 0)
    throw new InitUsageError(`--browser: name at least one of ${BROWSERS.join(", ")}`)

  return browsers
}
