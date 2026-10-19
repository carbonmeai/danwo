/**
 * The questions, in order: the engine, how the app starts, the model for agent steps, the
 * providers to emulate, the coding agents to teach, and whether to install. Each starts on what
 * detection found, and a question its flag already answered is not asked.
 */
import { type Answers, answersFromFlags, type InitFlags } from "./answers.ts"
import {
  AGENT_INFO,
  AGENTS,
  type AgentId,
  DEFAULT_COMPATIBLE_URL,
  type Engine,
  ENGINE_LABELS,
  ENGINES,
  MODEL_SOURCE_INFO,
  MODEL_SOURCES,
  type ModelSourceId,
  PROVIDER_IDS,
  PROVIDERS,
  type ProviderId,
  providerList,
} from "./catalog.ts"
import type { Detection } from "./detect.ts"
import type { DeviceCheck } from "./device.ts"
import { packagesToAdd } from "./install.ts"
import type { Choice, Prompter } from "./prompter.ts"
import { keyLine } from "./report.ts"

/** danwo's wordmark, drawn in text. */
const WORDMARK = [
  "      _",
  "   __| | __ _ _ ____      _____",
  "  / _` |/ _` | '_ \\ \\ /\\ / / _ \\",
  " | (_| | (_| | | | \\ V  V / (_) |",
  "  \\__,_|\\__,_|_| |_|\\_/\\_/ \\___/",
].join("\n")

/** What detection found, for the note that opens the prompts. */
function detectionNote(detection: Detection): string {
  const providers = providerList(detection.providers)

  return [
    `Project    ${detection.name} (${detection.framework.label}, ${detection.packageManager})`,
    `Starts     ${detection.devCommand} → ${detection.appUrl}`,
    `Providers  ${providers === "" ? "none found" : providers}`,
    ...(detection.hasConfig
      ? ["danwo      danwo.config.ts is here; you will see any change before it is replaced"]
      : []),
  ].join("\n")
}

function isUrl(value: string): string | undefined {
  return URL.canParse(value) ? undefined : "Enter a URL, e.g. http://localhost:3000"
}

function isVariable(value: string): string | undefined {
  return value === "" || /^[A-Z][A-Z0-9_]*$/.test(value)
    ? undefined
    : "Use capitals, digits and underscores, e.g. LOCAL_LLM_KEY"
}

const engineChoices: readonly Choice<Engine>[] = ENGINES.map((value) => ({
  value,
  ...ENGINE_LABELS[value],
}))

const sourceChoices: readonly Choice<ModelSourceId>[] = MODEL_SOURCES.map((value) => ({
  value,
  label: MODEL_SOURCE_INFO[value].label,
  hint: MODEL_SOURCE_INFO[value].hint,
}))

/** Where an Android test would boot, from the device check: its first usable AVD. */
async function askDevice(prompter: Prompter, checkDevice: () => Promise<DeviceCheck>) {
  const check = await prompter.task(
    "Checking this machine for Android testing",
    checkDevice,
    (found) =>
      found.problems.length === 0 ? "Ready for Android tests" : "Android testing needs some setup",
  )

  if (check.problems.length > 0) prompter.note(check.problems.join("\n"), "Before mobile tests run")

  return check.avd
}

/** How the app starts and where it answers. */
async function askApp(
  prompter: Prompter,
  base: Answers,
): Promise<Pick<Answers, "devCommand" | "appUrl">> {
  const devCommand = await prompter.text("How does the app start?", base.devCommand)
  const appUrl = await prompter.text("Where does it answer once started?", base.appUrl, isUrl)

  return { devCommand, appUrl }
}

/** The model source, its model, and for a compatible server, where it is and its key. */
async function askModel(
  prompter: Prompter,
  base: Answers,
  flags: InitFlags,
): Promise<Pick<Answers, "modelSource" | "model" | "baseUrl" | "keyEnv">> {
  const modelSource =
    flags.modelSource === undefined
      ? await prompter.select(
          "Which model should agent steps use?",
          sourceChoices,
          base.modelSource,
        )
      : base.modelSource

  if (modelSource === "none")
    return { modelSource, model: undefined, baseUrl: undefined, keyEnv: undefined }

  const server =
    modelSource === "openai-compatible"
      ? await askServer(prompter, base)
      : { baseUrl: undefined, keyEnv: undefined }
  const suggested =
    modelSource === base.modelSource ? base.model : MODEL_SOURCE_INFO[modelSource].model
  const model = flags.model ?? (await prompter.text("Which model?", suggested ?? ""))

  return { modelSource, model, ...server }
}

/** Where an OpenAI-compatible server answers, and the variable holding its key, if any. */
async function askServer(
  prompter: Prompter,
  base: Answers,
): Promise<Pick<Answers, "baseUrl" | "keyEnv">> {
  const baseUrl = await prompter.text(
    "Where does the server answer?",
    base.baseUrl ?? DEFAULT_COMPATIBLE_URL,
    isUrl,
  )
  const keyEnv = await prompter.text(
    "Which variable holds its key? (empty for none)",
    base.keyEnv ?? "",
    isVariable,
  )

  return { baseUrl, keyEnv: keyEnv === "" ? undefined : keyEnv }
}

async function askProviders(prompter: Prompter, base: Answers): Promise<ProviderId[]> {
  const found = new Set(base.providers)
  const choices = PROVIDER_IDS.map((value) => ({
    value,
    label: PROVIDERS[value].label,
    ...(found.has(value) && { hint: "found in this project" }),
  }))

  return prompter.multiselect("Which providers should danwo emulate?", choices, base.providers)
}

async function askAgents(
  prompter: Prompter,
  base: Answers,
): Promise<Pick<Answers, "agents" | "mcp">> {
  const choices: Choice<AgentId>[] = AGENTS.map((value) => ({
    value,
    label: AGENT_INFO[value].label,
  }))
  const agents = await prompter.multiselect(
    "Which coding agents should learn danwo? (installs its skill)",
    choices,
    base.agents,
  )
  const withMcp = agents.some((id) => AGENT_INFO[id].mcpFile !== undefined)
  const mcp = withMcp
    ? await prompter.confirm("Register danwo's MCP server with them too?", base.mcp)
    : false

  return { agents, mcp }
}

/** Every answer: flags first, the prompts for the rest. */
export async function askAnswers(
  prompter: Prompter,
  detection: Detection,
  flags: InitFlags,
  checkDevice: () => Promise<DeviceCheck>,
): Promise<Answers> {
  prompter.intro(WORDMARK)
  prompter.note(detectionNote(detection), "Found")

  const base = answersFromFlags(detection, flags)
  const engine =
    flags.engine === undefined
      ? await prompter.select("What should tests drive?", engineChoices, base.engine)
      : base.engine
  const mobile = engine === "mobile" || engine === "both"
  const avd = mobile ? await askDevice(prompter, checkDevice) : undefined
  const app = engine === "mobile" ? {} : await askApp(prompter, base)
  const model = await askModel(prompter, base, flags)
  const providers =
    flags.providers === undefined ? await askProviders(prompter, base) : base.providers
  const agents = flags.skills === undefined ? await askAgents(prompter, base) : base

  const answers: Answers = {
    ...base,
    ...app,
    ...model,
    engine,
    providers,
    agents: agents.agents,
    mcp: agents.mcp,
    avd,
  }
  const key = keyLine(answers, detection)

  if (key !== undefined) prompter.note(key, "Model key")

  return { ...answers, install: await askInstall(prompter, answers, detection, flags) }
}

/** Whether to add the packages the files import, when any are missing. */
async function askInstall(
  prompter: Prompter,
  answers: Answers,
  detection: Detection,
  flags: InitFlags,
): Promise<boolean> {
  const packages = packagesToAdd(answers, detection)

  if (flags.skipInstall === true || packages.length === 0) return answers.install

  return prompter.confirm(
    `Add ${packages.map((spec) => spec.name).join(", ")} with ${detection.packageManager}?`,
    true,
  )
}
