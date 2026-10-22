// fallow-ignore-file unused-class-member -- the AI SDK calls a model through the LanguageModelV4 interface
/**
 * A coding CLI the user installed and signed in to, as an AI SDK language model: each call starts
 * the CLI once, non-interactively, in an empty temporary folder, with its own tools off and its
 * sandbox read-only, and reads its answer back as text or tool calls. The CLI does its own sign-in;
 * danwo never reads, copies or reuses its credentials, and only asks the CLI's own status command
 * whether it is signed in.
 */
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
  LanguageModelV4Usage,
} from "@ai-sdk/provider"

import { type CliInfo, signedOut } from "./failure.ts"
import { answerContent, type CliPrompt, cliPrompt } from "./protocol.ts"
import { type CliCommand, type CliExit, runCli } from "./run.ts"

/** Options every CLI model takes. */
export interface CliModelOptions {
  /** How long one call may run before the CLI is stopped; default 3 minutes. */
  readonly timeoutMs?: number
  /**
   * How many of a call's images (the page's screenshots) go along, newest first; default 2.
   * `0` sends text-only page views, which is faster.
   */
  readonly maxImages?: number
  /** The program to start, or a program and its first arguments; default the CLI's own name. */
  readonly command?: CliCommand
  /** Variables added to the CLI's environment. */
  readonly env?: Readonly<Record<string, string>>
}

/** Where a CLI stands on this machine, for `danwo doctor`. */
export interface CliStatus {
  readonly title: string
  /** The command that signs it in. */
  readonly login: string
  /** Its version, or undefined when it is not installed or did not say. */
  readonly version?: string
  readonly installed: boolean
  /** Whether its own status command says it is signed in; undefined when it is not installed. */
  readonly signedIn?: boolean
  /** How it is signed in, in words, never a credential. */
  readonly detail: string
}

/** The files one call hands the CLI, in a folder of their own beside the empty working folder. */
export interface CallFiles {
  /** The empty folder the CLI runs in. */
  readonly work: string
  readonly images: readonly string[]
  /** Writes `text` to a file named `name` beside the images, and gives its path. */
  readonly write: (name: string, text: string) => Promise<string>
}

/** What one run of the CLI answered. */
export interface CliAnswer {
  readonly text: string
  readonly usage: LanguageModelV4Usage
}

/** The key a CLI model's status method sits under. */
const CLI_STATUS = Symbol.for("danwo.cli-model.status")

const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_MAX_IMAGES = 2
const STATUS_TIMEOUT_MS = 30_000

/** Usage when the CLI reports none. */
export const NO_USAGE: LanguageModelV4Usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

/** A language model that is one run of a CLI per call. */
export abstract class CliModel implements LanguageModelV4 {
  readonly specificationVersion = "v4"
  readonly supportedUrls: Record<string, RegExp[]> = {}
  abstract readonly provider: string
  abstract readonly modelId: string
  protected abstract readonly cli: CliInfo
  private signedIn: Promise<void> | undefined

  protected readonly options: CliModelOptions

  constructor(options: CliModelOptions) {
    this.options = options
  }

  /** The arguments that sign-in status is asked with: `["login", "status"]`. */
  protected abstract readonly statusArgs: readonly string[]

  /** Whether the status command's exit says signed in, and how, in words with no credential. */
  protected abstract signInOf(exit: CliExit): { readonly signedIn: boolean; readonly how: string }

  /** Runs the CLI once for `prompt` and reads its answer; throws a `CliModelError` on failure. */
  protected abstract answer(
    prompt: CliPrompt,
    files: CallFiles,
    signal: AbortSignal | undefined,
  ): Promise<CliAnswer>

  protected get command(): CliCommand {
    return this.options.command ?? this.cli.program
  }

  protected get timeoutMs(): number {
    return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** Runs the CLI with `args`, under the model's command, environment and a deadline. */
  protected run(
    args: readonly string[],
    extra: { readonly stdin?: string; readonly cwd?: string; readonly signal?: AbortSignal },
    timeoutMs = this.timeoutMs,
  ): Promise<CliExit> {
    return runCli(this.cli, {
      command: this.command,
      args,
      timeoutMs,
      ...(this.options.env !== undefined && { env: this.options.env }),
      ...extra,
    })
  }

  /** Version, install and sign-in, each from the CLI itself. */
  async status(): Promise<CliStatus> {
    const base = { title: this.cli.title, login: this.cli.login }
    const version = await this.run(["--version"], {}, STATUS_TIMEOUT_MS).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    )

    if (version instanceof Error) return { ...base, installed: false, detail: version.message }

    const said = /\d+\.\d+[\w.+-]*/.exec(`${version.stdout} ${version.stderr}`)?.[0]
    const sign = await this.run(this.statusArgs, {}, STATUS_TIMEOUT_MS).then(
      (exit) => this.signInOf(exit),
      (error: unknown) => ({
        signedIn: false,
        how: error instanceof Error ? error.message : String(error),
      }),
    )

    return {
      ...base,
      installed: true,
      ...(said !== undefined && { version: said }),
      signedIn: sign.signedIn,
      detail: sign.how,
    }
  }

  /** Checks once per model that the CLI is installed and signed in; a failed check is not kept. */
  private ensureSignedIn(): Promise<void> {
    this.signedIn ??= this.run(this.statusArgs, {}, STATUS_TIMEOUT_MS)
      .then((exit) => {
        if (!this.signInOf(exit).signedIn) throw signedOut(this.cli)
      })
      .catch((error: unknown) => {
        this.signedIn = undefined
        throw error
      })

    return this.signedIn
  }

  async doGenerate(options: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
    await this.ensureSignedIn()

    const prompt = cliPrompt(options, this.options.maxImages ?? DEFAULT_MAX_IMAGES)
    const dir = await mkdtemp(join(tmpdir(), "danwo-cli-"))

    try {
      const files = await this.files(dir, prompt)
      const answer = await this.answer(prompt, files, options.abortSignal)
      const content = answerContent(answer.text, prompt.schema !== undefined, () => randomUUID())
      const calls = content.some((part) => part.type === "tool-call")

      return {
        content,
        finishReason: { unified: calls ? "tool-calls" : "stop", raw: undefined },
        usage: answer.usage,
        warnings: [...prompt.warnings],
      }
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }

  /** One call as a stream: the whole answer, once the CLI has given it. */
  async doStream(options: LanguageModelV4CallOptions): Promise<LanguageModelV4StreamResult> {
    const result = await this.doGenerate(options)
    const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: result.warnings }]

    for (const [index, part] of result.content.entries()) {
      if (part.type === "text") {
        const id = `text-${index}`

        parts.push(
          { type: "text-start", id },
          { type: "text-delta", id, delta: part.text },
          { type: "text-end", id },
        )
      } else if (part.type === "tool-call") parts.push(part)
    }

    parts.push({ type: "finish", usage: result.usage, finishReason: result.finishReason })

    return {
      stream: new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part)
          controller.close()
        },
      }),
    }
  }

  /** Lays out a call's folder: the empty working folder, and the images in a folder beside it. */
  private async files(dir: string, prompt: CliPrompt): Promise<CallFiles> {
    const work = join(dir, "work")
    const inputs = join(dir, "inputs")

    await mkdir(work)
    await mkdir(inputs)

    const images = await Promise.all(
      prompt.images.map(async (image, index) => {
        const path = join(inputs, `image-${index + 1}.${EXTENSIONS[image.mediaType] ?? "png"}`)

        await writeFile(path, image.bytes)

        return path
      }),
    )

    return {
      work,
      images,
      async write(name, text) {
        const path = join(inputs, name)

        await writeFile(path, text)

        return path
      },
    }
  }

  /** The status under a key every copy of danwo shares, so a config loaded apart still has it. */
  [CLI_STATUS](): Promise<CliStatus> {
    return this.status()
  }
}

/** The status of the CLI `model` runs on, when it is a CLI model; for `danwo doctor`. */
export function cliStatusOf(model: unknown): Promise<CliStatus> | undefined {
  if (typeof model !== "object" || model === null) return undefined

  const status: unknown = Reflect.get(model, CLI_STATUS)

  return typeof status === "function"
    ? Promise.resolve(Reflect.apply(status, model, []))
    : undefined
}
