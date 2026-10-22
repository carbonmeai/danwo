/**
 * Agent steps on a ChatGPT plan, through the OpenAI Codex CLI the user installed and signed in to
 * with `codex login`. Each model call is one `codex exec`: the prompt on stdin, screenshots as
 * `--image` files, the answer held to a JSON schema with `--output-schema`, and events (the answer,
 * token usage, failures) read from `--json`. Codex runs with its sandbox read-only, approvals off,
 * its shell, web search and other tools disabled, no user config or rules loaded, nothing saved,
 * in an empty temporary folder.
 */
import type { LanguageModelV4, LanguageModelV4Usage } from "@ai-sdk/provider"
import { z } from "zod"

import { type CliInfo, cliFailure } from "./failure.ts"
import {
  type CallFiles,
  type CliAnswer,
  CliModel,
  type CliModelOptions,
  NO_USAGE,
} from "./model.ts"
import type { CliPrompt } from "./protocol.ts"
import type { CliExit } from "./run.ts"

/** How `codexCli()` runs the Codex CLI: which model, how hard it reasons, and the CLI's limits. */
export interface CodexCliOptions extends CliModelOptions {
  /** The model Codex runs (`codex exec --model`); default the one Codex picks for the plan. */
  readonly model?: string
  /** How hard the model reasons (`model_reasoning_effort`); default Codex's own. */
  readonly reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"
}

const CODEX: CliInfo = {
  title: "Codex CLI",
  program: "codex",
  login: "codex login",
  install: "npm install -g @openai/codex",
  plan: "ChatGPT",
}

/**
 * Codex's own tools and integrations, each turned off. Set as config keys rather than with
 * `--disable`, which refuses a name this Codex does not know; an unknown config key is ignored.
 */
const OFF_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apply_patch_freeform",
  "view_image",
  "web_search_request",
  "image_generation",
  "apps",
  "plugins",
  "browser_use",
  "computer_use",
  "in_app_browser",
  "multi_agent",
  "hooks",
  "memories",
  "goals",
  "skill_search",
  "tool_suggest",
  "sleep_tool",
  "code_mode_host",
  "js_repl",
]

/** `value` as a TOML string, which `-c key=value` reads; a JSON string is one. */
function toml(value: string): string {
  return JSON.stringify(value)
}

/** The `codex exec` arguments for one call, the prompt read from stdin. */
export function codexArgs(
  options: CodexCliOptions,
  files: { readonly work: string; readonly images: readonly string[] },
  extra: { readonly instructions: string; readonly schema?: string },
): string[] {
  return [
    "exec",
    ...files.images.flatMap((image) => ["--image", image]),
    "--json",
    "--color",
    "never",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--cd",
    files.work,
    "-c",
    `approval_policy=${toml("never")}`,
    "-c",
    `web_search=${toml("disabled")}`,
    ...OFF_FEATURES.flatMap((feature) => ["-c", `features.${feature}=false`]),
    "-c",
    `model_instructions_file=${toml(extra.instructions)}`,
    ...(options.model === undefined ? [] : ["--model", options.model]),
    ...(options.reasoningEffort === undefined
      ? []
      : ["-c", `model_reasoning_effort=${toml(options.reasoningEffort)}`]),
    ...(extra.schema === undefined ? [] : ["--output-schema", extra.schema]),
    "-",
  ]
}

const EVENT = z.union([
  z.object({
    type: z.literal("item.completed"),
    item: z.object({ type: z.string(), text: z.string().optional() }),
  }),
  z.object({
    type: z.literal("turn.completed"),
    usage: z
      .object({
        input_tokens: z.number().optional(),
        cached_input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
        reasoning_output_tokens: z.number().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("turn.failed"),
    error: z.object({ message: z.string() }).optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
])

type CodexEvent = z.infer<typeof EVENT>

/** The events in Codex's `--json` output; lines that are not events are skipped. */
function eventsOf(stdout: string): CodexEvent[] {
  return stdout.split("\n").flatMap((line) => {
    if (!line.startsWith("{")) return []

    try {
      const parsed = EVENT.safeParse(JSON.parse(line))

      return parsed.success ? [parsed.data] : []
    } catch {
      return []
    }
  })
}

/** Codex's token counts as the AI SDK's usage; its input count includes what was cached. */
function usageOf(event: Extract<CodexEvent, { type: "turn.completed" }>): LanguageModelV4Usage {
  const usage = event.usage

  if (usage === undefined) return NO_USAGE

  const input = usage.input_tokens
  const cached = usage.cached_input_tokens
  const output = usage.output_tokens
  const reasoning = usage.reasoning_output_tokens

  return {
    inputTokens: {
      total: input,
      noCache: input === undefined ? undefined : input - (cached ?? 0),
      cacheRead: cached,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: output,
      text: output === undefined ? undefined : output - (reasoning ?? 0),
      reasoning,
    },
  }
}

/** The text of Codex's last message, when it gave one. */
function lastMessage(events: readonly CodexEvent[]): string | undefined {
  let text: string | undefined

  for (const event of events)
    if (event.type === "item.completed" && event.item.type === "agent_message")
      text = event.item.text

  return text
}

/** The token counts of the finished turn, when Codex reported them. */
function lastUsage(events: readonly CodexEvent[]): LanguageModelV4Usage {
  const done = events.findLast((event) => event.type === "turn.completed")

  return done?.type === "turn.completed" ? usageOf(done) : NO_USAGE
}

/** What Codex said went wrong: the failed turn's message, else its last error, else stderr. */
function failureText(events: readonly CodexEvent[], stderr: string): string {
  const said = events.flatMap((event) => {
    if (event.type === "turn.failed") return [event.error?.message ?? ""]

    return event.type === "error" ? [event.message] : []
  })

  return said.at(-1) ?? stderr.trim()
}

/** The answer in a finished run's events, or the failure they and the exit describe. */
function codexAnswer(exit: CliExit): CliAnswer {
  const events = eventsOf(exit.stdout)
  const failed = events.some((event) => event.type === "turn.failed")
  const text = lastMessage(events)

  if (!failed && exit.code === 0 && text !== undefined) return { text, usage: lastUsage(events) }

  throw cliFailure(CODEX, failureText(events, exit.stderr), exit.code === 0 ? null : exit.code)
}

class CodexCliModel extends CliModel {
  readonly provider = "codex-cli"
  readonly modelId: string
  protected readonly cli = CODEX
  protected readonly statusArgs = ["login", "status"]
  private readonly codex: CodexCliOptions

  constructor(options: CodexCliOptions) {
    super(options)
    this.codex = options
    this.modelId = options.model ?? "default"
  }

  protected signInOf(exit: CliExit) {
    const said = `${exit.stdout}\n${exit.stderr}`

    if (exit.code !== 0 || /not logged in/i.test(said))
      return { signedIn: false, how: "not signed in; run `codex login`" }

    return {
      signedIn: true,
      how: /chatgpt/i.test(said) ? "signed in with ChatGPT" : "signed in (not with ChatGPT)",
    }
  }

  protected async answer(
    prompt: CliPrompt,
    files: CallFiles,
    signal: AbortSignal | undefined,
  ): Promise<CliAnswer> {
    const instructions = await files.write(
      "instructions.md",
      prompt.system === "" ? "Answer the last message." : prompt.system,
    )
    const schema =
      prompt.schema === undefined
        ? undefined
        : await files.write("answer.schema.json", JSON.stringify(prompt.schema))
    const args = codexArgs(this.codex, files, {
      instructions,
      ...(schema !== undefined && { schema }),
    })
    const exit = await this.run(args, {
      stdin: prompt.text,
      cwd: files.work,
      ...(signal !== undefined && { signal }),
    })

    return codexAnswer(exit)
  }
}

/**
 * A model that runs agent steps on your ChatGPT plan through the Codex CLI, with no API key:
 * `model: codexCli()` in `danwo.config.ts`. Install the CLI and run `codex login` once; danwo
 * starts `codex exec` for each model call, read-only and with Codex's own tools off.
 */
export function codexCli(options: CodexCliOptions = {}): LanguageModelV4 {
  return new CodexCliModel(options)
}
