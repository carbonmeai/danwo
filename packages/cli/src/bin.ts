#!/usr/bin/env node
/*
 * `danwo test` and `danwo matrix`. Runs under Node 22 or 24 with native type stripping; the runner
 * forks its workers with its own resolve hook.
 */
import { resolve as resolvePath } from "node:path"

import "@danwo/runner/register"
import { github } from "@danwo/github"
import type { InitFlags } from "@danwo/init"
import { AGENTS, DANWO_VERSION, ENGINES, MODEL_SOURCES, PROVIDER_IDS } from "@danwo/init/catalog"
import {
  type CacheAction,
  exitCodeForError,
  explainImpact,
  junit,
  lintRun,
  mergeReports,
  parseDuration,
  type RecordMode,
  type Reporter,
  runCache,
  runMatrix,
  runTests,
  showRun,
  type VideoMode,
} from "@danwo/runner/runner"
import { Argument, Command, InvalidArgumentError, Option } from "commander"

import { cliCommands } from "./commands.ts"

/** What `--reporter` and `--no-pr-comment` set. */
interface ReporterFlags {
  readonly reporter?: string[] | undefined
  /** `false` with `--no-pr-comment`. */
  readonly prComment?: boolean | undefined
}

/** Reporters by the names `--reporter` takes; the console's list output always runs. */
const REPORTERS: Readonly<Record<string, (flags: ReporterFlags) => Reporter>> = {
  github: (flags) => github(flags.prComment === false ? { prComment: false } : {}),
  junit: () => junit(),
}

/** The reporters named by `--reporter`, comma-separated or repeated. */
function reportersOf({ reporter: names, ...flags }: ReporterFlags): Reporter[] {
  return (names ?? [])
    .flatMap((name) => name.split(","))
    .map((name) => name.trim())
    .filter((name) => name !== "" && name !== "list")
    .map((name) => {
      const make = REPORTERS[name]

      if (make === undefined) {
        throw new InvalidArgumentError(`unknown reporter "${name}" (known: list, github, junit)`)
      }

      return make(flags)
    })
}

/** `--max-duration`'s value in milliseconds. */
function duration(value: string): number {
  const ms = parseDuration(value)

  if (ms === undefined) throw new InvalidArgumentError("expected a duration such as 20m, 90s or 1h")

  return ms
}

function integerAtLeast(min: number): (value: string) => number {
  return (value) => {
    const n = Number(value)

    if (!Number.isInteger(n) || n < min) {
      throw new InvalidArgumentError(`expected an integer >= ${min}`)
    }

    return n
  }
}

const recordOption = () =>
  new Option(
    "--record <mode>",
    "flight recorder: keep what runs did (default: config, else always)",
  ).choices(["on-failure", "always", "off"])

const videoOption = () =>
  new Option(
    "--video <mode>",
    "video in kept records: retain-on-failure keeps failed runs' (default: config, else on)",
  ).choices(["retain-on-failure", "on", "off"])

const keepRunsOption = () =>
  new Option(
    "--keep-runs <n>",
    "how many of the newest runs keep their recordings (default: config, else 50)",
  ).argParser(integerAtLeast(1))

const updateOption = () =>
  new Option("-u, --update-snapshots", "rewrite every toHaveScreenshot baseline")

/** `--lint` and `--no-lint`; neither given follows the config (on unless it says `lint: false`). */
function withLintOptions(command: Command): Command {
  return command
    .option("--lint", "run the integration lint over provider calls and webhooks (default: on)")
    .option("--no-lint", "skip the integration lint")
}

const reporterOption = () =>
  new Option(
    "--reporter <names...>",
    "reporters besides the console's list: github (a check run, a pull request comment and the job summary in GitHub Actions), junit (.danwo/junit.xml)",
  )

/** `--reporter`, and `--no-pr-comment` for the github reporter. */
function withReporterOptions(command: Command): Command {
  return command
    .addOption(reporterOption())
    .option("--no-pr-comment", "github reporter: no pull request comment, only the check run")
}

const program = new Command()
  .name("danwo")
  .description("Drive your app like a user, judge the layers below, and run the fault matrix.")
  .version(DANWO_VERSION)

withReporterOptions(withLintOptions(program.command("test")))
  .description("run test files in worker processes")
  .argument("[patterns...]", "file paths or substrings narrowing the config's testMatch")
  .option("-w, --workers <n>", "worker processes", integerAtLeast(1))
  .option(
    "--split-files",
    "hand workers single tests of the files whose tests share nothing (no beforeAll or afterAll)",
  )
  .option("-r, --retries <n>", "retries per test", integerAtLeast(0))
  .option("-g, --grep <regexp>", "only tests whose full title matches")
  .option("--last-failed", "only the tests that failed in the latest run; merges into it")
  .option("--changed", "only the tests the changed files can affect (see danwo impact)")
  .option("--since <ref>", "what --changed compares with (default: HEAD, uncommitted changes)")
  .option("--shard <i/n>", "this machine's share of the test files, e.g. 2/4")
  .option(
    "--max-failures <n>",
    "start no new test file once this many tests failed",
    integerAtLeast(1),
  )
  .option(
    "--max-duration <time>",
    "start no new test file once the run has taken this long, e.g. 20m (files left out fail the run)",
    duration,
  )
  .option("--ci", "CI defaults even without the CI variable: 1 retry, read-only cache, no .only")
  .option(
    "--replay-only",
    "replay recorded agent steps and call no model: a step with no recording that replays fails",
  )
  .option("--list", "print the picked tests as JSON (id, file) instead of running them")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .addOption(recordOption())
  .addOption(videoOption())
  .addOption(keepRunsOption())
  .addOption(updateOption())
  .action(
    async (
      patterns: string[],
      {
        updateSnapshots,
        reporter,
        prComment,
        maxDuration,
        ...options
      }: {
        workers?: number
        splitFiles?: boolean
        retries?: number
        grep?: string
        lastFailed?: boolean
        changed?: boolean
        since?: string
        shard?: string
        maxFailures?: number
        maxDuration?: number
        ci?: boolean
        replayOnly?: boolean
        list?: boolean
        config?: string
        record?: RecordMode
        video?: VideoMode
        keepRuns?: number
        updateSnapshots?: boolean
        reporter?: string[]
        prComment?: boolean
        lint?: boolean
      },
    ) => {
      process.exitCode = await runTests({
        patterns,
        ...options,
        ...(maxDuration !== undefined && { maxDurationMs: maxDuration }),
        reporters: reportersOf({ reporter, prComment }),
        ...(updateSnapshots && { updateScreenshots: true }),
      })
    },
  )

withReporterOptions(withLintOptions(program.command("matrix")))
  .description("record a clean run of one test, then replay it once per planned fault")
  .argument("<file>", "test file")
  .option("-g, --grep <regexp>", "selects the test when the file has several")
  .option("-f, --faults <regexp>", "only the planned faults whose labels match")
  .option(
    "-w, --workers <n>",
    "worker processes (default: one per core, at most 8)",
    integerAtLeast(1),
  )
  .option("--max-failures <n>", "start no new run once this many failed", integerAtLeast(1))
  .option("--shuffle <seed>", "run the faulted runs in a shuffled order", integerAtLeast(0))
  .option(
    "--plan",
    "run the clean run, print the planned faults and how long they would take, and stop",
  )
  .option(
    "--budget <n>",
    "at most this many faulted runs (default: config, else 40)",
    integerAtLeast(1),
  )
  .option("--all", "every fault on the test's body, background work included, with no budget")
  .option("--thorough", "every fault kind on each call, not only the most telling ones")
  .option(
    "--every-occurrence",
    "faults on every repeat of a route or statement, not only its first",
  )
  .option(
    "--include-setup",
    "fault the test's setup too: its saved session signing in, fixtures and beforeEach",
  )
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .addOption(recordOption())
  .addOption(videoOption())
  .addOption(keepRunsOption())
  .addOption(updateOption())
  .action(
    async (
      file: string,
      {
        updateSnapshots,
        reporter,
        prComment,
        ...options
      }: {
        grep?: string
        faults?: string
        workers?: number
        maxFailures?: number
        shuffle?: number
        plan?: boolean
        budget?: number
        all?: boolean
        thorough?: boolean
        everyOccurrence?: boolean
        includeSetup?: boolean
        config?: string
        record?: RecordMode
        video?: VideoMode
        keepRuns?: number
        updateSnapshots?: boolean
        reporter?: string[]
        prComment?: boolean
        lint?: boolean
      },
    ) => {
      const update = updateSnapshots ? { updateScreenshots: true } : {}
      const reporters = reportersOf({ reporter, prComment })

      process.exitCode = (await runMatrix({ file, ...options, reporters, ...update })).code
    },
  )

withReporterOptions(program.command("merge-reports"))
  .description("join the results of a split run (danwo test --shard i/n) into one report")
  .argument("[files...]", "results files (default: .danwo/results/shard-*.json)")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .action(async (files: string[], options: { config?: string } & ReporterFlags) => {
    process.exitCode = await mergeReports({
      files,
      ...(options.config !== undefined && { config: options.config }),
      reporters: reportersOf(options),
    })
  })

program
  .command("impact")
  .description("which tests a change to these files selects for danwo test --changed, and why")
  .argument("<files...>", "changed files")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .action(async (files: string[], options: { config?: string }) => {
    process.exitCode = await explainImpact({
      files,
      ...(options.config !== undefined && { config: options.config }),
    })
  })

program
  .command("mcp")
  .description("serve this project to coding agents over MCP (stdio)")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .option("--max-sessions <n>", "live sessions open at once", integerAtLeast(1), 4)
  .action(async (options: { config?: string; maxSessions: number }) => {
    const { serveStdio } = await import("@danwo/mcp")

    await serveStdio({
      cwd: process.cwd(),
      config: options.config,
      sessions: { max: options.maxSessions },
      version: DANWO_VERSION,
      commands: cliCommands(program),
    })
  })

program
  .command("init")
  .description(
    "set danwo up in this project: the engine, the model for agent steps, the providers to emulate and the coding agents to teach; writes danwo.config.ts, an example test and a test:danwo script, and installs what they import. Asks in a terminal; with --yes or no terminal it takes the flags and what it detects",
  )
  .option("-y, --yes", "ask nothing: the flags, and the detected defaults for the rest")
  .addOption(new Option("--engine <engine>", "what tests drive").choices(ENGINES))
  .addOption(
    new Option("--model-source <source>", "where agent steps get their model").choices(
      MODEL_SOURCES,
    ),
  )
  .option("--model <id>", "the model id, e.g. anthropic/claude-sonnet-5 on the AI Gateway")
  .option(
    "--base-url <url>",
    "an OpenAI-compatible server's URL (--model-source openai-compatible)",
  )
  .option("--key-env <name>", "the variable holding that server's key, when it takes one")
  .option(
    "--providers <list>",
    `providers to emulate, comma-separated, or none (${PROVIDER_IDS.join(", ")})`,
  )
  .option(
    "--skills <list>",
    `coding agents to install danwo's skill for, comma-separated, or none (${AGENTS.join(", ")})`,
  )
  .option("--no-mcp", "do not register danwo's MCP server with those agents")
  .option("--dev-command <command>", "the command that starts the app, e.g. 'pnpm dev'")
  .option("--app-url <url>", "where the app answers once started")
  .option("--skip-install", "write the files but install no packages")
  .option("--force", "replace a danwo.config.ts that differs from the one init writes")
  .action(async (options: InitFlags) => {
    const { InitCancelled, runInit, terminalPrompter } = await import("@danwo/init")
    const interactive = options.yes !== true && process.stdin.isTTY && process.stdout.isTTY

    try {
      const outcome = await runInit({
        cwd: process.cwd(),
        flags: options,
        ...(interactive && { prompter: terminalPrompter }),
      })

      if (!interactive) console.log(outcome.summary)
    } catch (error) {
      if (!(error instanceof InitCancelled)) throw error
      process.exitCode = 130
    }
  })

program
  .command("doctor")
  .description(
    "check what a first run needs: Node, danwo's Chromium, the config and its keys, the model's key, Playwright Test's version and the agents' skill",
  )
  .option("--json", "the checks as JSON: { ok, checks: [{ name, status, detail }] }")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .action(async (options: { json?: boolean; config?: string }) => {
    const { doctorLines, projectDoctor } = await import("./doctor.ts")
    const { browserInstalled } = await import("@danwo/runner")
    const checks = await projectDoctor(
      { cwd: process.cwd(), config: options.config },
      { nodeVersion: process.version, env: process.env, browser: browserInstalled },
    )
    const ok = checks.every((check) => check.status !== "fail")

    console.log(options.json ? JSON.stringify({ ok, checks }) : doctorLines(checks).join("\n"))
    process.exitCode = ok ? 0 : 1
  })

program
  .command("install-browser")
  .description(
    "install the Chromium build danwo drives, with danwo's own Playwright, once per machine; other Playwright installs' browsers are kept",
  )
  .option("--with-deps", "also install the system libraries Chromium needs (Linux)")
  .option(
    "--only-shell",
    "only the headless shell test runs use (smaller, for CI); not for danwo record",
  )
  .option("--dry-run", "say what would be installed, and install nothing")
  .action(async (options: { withDeps?: boolean; onlyShell?: boolean; dryRun?: boolean }) => {
    const { installBrowser } = await import("@danwo/runner")

    process.exitCode = await installBrowser(options)
  })

program
  .command("record")
  .description(
    "record a test by using the app in a browser: locators for each action, what it caused behind the app, and a drafted invariant",
  )
  .argument("[path]", "the app page to start on", "/")
  .option(
    "-o, --out <file>",
    "the new test file, relative to the project (default: <testDir>/recorded.danwo.ts)",
  )
  .option("-n, --name <title>", "the test's title", "recorded journey")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .action(async (path: string, options: { out?: string; name: string; config?: string }) => {
    const { recordedReport, startRecording } = await import("@danwo/recorder")
    const recording = await startRecording({ cwd: process.cwd(), config: options.config, path })
    const interrupted = new Promise<void>((resolve) => process.once("SIGINT", () => resolve()))

    console.log(
      "recording: use the app in the browser, then press Stop on the danwo toolbar (or Ctrl-C)",
    )
    await Promise.race([recording.stopped, interrupted])
    console.log(recordedReport(await recording.finish({ out: options.out, name: options.name })))
  })

program
  .command("show")
  .description("print the path of a recorded run's report (the newest by default)")
  .argument("[run-id]", "a run under .danwo/runs")
  .option("-o, --open", "open the report in the browser")
  .addOption(
    new Option(
      "--format <format>",
      "html: the report's path; md: a failure page for each failed run",
    )
      .choices(["html", "md"])
      .default("html"),
  )
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .action(
    async (
      runId: string | undefined,
      options: { open?: boolean; config?: string; format?: "html" | "md" },
    ) => {
      process.exitCode = await showRun({ ...(runId !== undefined && { runId }), ...options })
    },
  )

program
  .command("lint")
  .description(
    "run the integration lint again over a recorded run (the newest by default); record passing runs too with --record always",
  )
  .argument("[run-id]", "a run under .danwo/runs")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .action(async (runId: string | undefined, options: { config?: string }) => {
    process.exitCode = await lintRun({ ...(runId !== undefined && { runId }), ...options })
  })

program
  .command("serve")
  .description(
    "start the dashboard: runs, flight records, matrix grids and flaky tests from .danwo",
  )
  .option(
    "-p, --port <port>",
    "port on 127.0.0.1 (default 4310; 0 picks a free one)",
    integerAtLeast(0),
  )
  .option("-o, --open", "open the dashboard in the browser")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .action(async (options: { port?: number; open?: boolean; config?: string }) => {
    const { serveDashboard } = await import("@danwo/dashboard")
    const dashboard = await serveDashboard(options)
    const stop = () => void dashboard.close().then(() => process.exit(0))

    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
  })

program
  .command("cache")
  .description("list, count or clear the replay cache's recordings")
  .addArgument(new Argument("<action>").choices(["ls", "stats", "clear"]))
  .option("-j, --journey <test-id>", "only the recordings of this test")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .action(async (action: CacheAction, options: { journey?: string; config?: string }) => {
    process.exitCode = await runCache(action, options)
  })

program
  .command("spec")
  .description(
    "print what this danwo provides, generated from its code: API, config, faults, codes",
  )
  .option("--json", "compact JSON instead of text")
  .option(
    "-t, --topic <topic>",
    "one section: api, fixtures, locators, expect, agent, secrets, config, environments, emulators, faults, cli, errors, cache, lint, exports",
  )
  .action(async (options: { json?: boolean; topic?: string }) => {
    const { buildSpec, renderSpec, specJson, specTopic } = await import("@danwo/skill")
    const spec = buildSpec({ commands: cliCommands(program) })
    const shown = options.topic === undefined ? spec : specTopic(spec, options.topic)

    console.log(options.json ? specJson(shown) : renderSpec(shown))
  })

/**
 * The fidelity checks. They compare the emulators with goldens kept in danwo's own repository, so
 * they are not published: a clone of that repository has them, an installed danwo does not.
 */
async function fidelity() {
  try {
    return await import("@danwo/fidelity")
  } catch (error) {
    if (Reflect.get(Object(error), "code") !== "ERR_MODULE_NOT_FOUND") throw error

    throw new Error(
      "danwo fidelity runs in a clone of the danwo repository, which holds its goldens",
      {
        cause: error,
      },
    )
  }
}

/** `danwo fidelity login <provider>`: signs a test account in and keeps its refresh token. */
async function fidelityLogin(
  provider: string,
  root: string,
  options: { redirectUri?: string; port?: number },
): Promise<number> {
  const { loginCommand } = await fidelity()

  return loginCommand({
    provider,
    root,
    ...(options.redirectUri !== undefined && { redirectUri: options.redirectUri }),
    ...(options.port !== undefined && { port: options.port }),
  })
}

program
  .command("fidelity")
  .description(
    "check the emulators against the real providers' sandboxes (with DANWO_FIDELITY_* credentials) or the committed goldens",
  )
  .argument(
    "[providers...]",
    "providers to check (default: all); `login google|microsoft` signs a test account in instead",
  )
  .option(
    "--update-golden",
    "keep the sandbox's (or the API description's) structure as the new golden",
  )
  .option(
    "--from-openapi [file]",
    "make goldens from API descriptions: a file for one provider, or each provider's published one",
  )
  .option("--offline", "compare against the goldens even when credentials are set")
  .option(
    "--keep",
    "leave what live runs make in the sandboxes, listed as kept, instead of undoing it",
  )
  .option(
    "--sweep",
    "list leftovers tagged danwo-fidelity from earlier live runs instead of checking; --yes removes them",
  )
  .option("--yes", "with --sweep, remove the tagged leftovers it lists")
  .option("--root <dir>", "the danwo repository holding fidelity/ (default: the current folder)")
  .option(
    "--redirect-uri <uri>",
    "with login: the redirect URI the OAuth client registers (default: DANWO_FIDELITY_<PROVIDER>_REDIRECT_URI, else http://127.0.0.1:8765/callback)",
  )
  .option("--port <port>", "with login: the port of the default redirect URI", Number)
  .action(
    async (
      providers: string[],
      options: {
        updateGolden?: boolean
        fromOpenapi?: string | true
        offline?: boolean
        keep?: boolean
        sweep?: boolean
        yes?: boolean
        root?: string
        redirectUri?: string
        port?: number
      },
    ) => {
      const { fidelityCommand, sweepCommand } = await fidelity()
      const root = options.root ?? process.cwd()

      if (providers[0] === "login") {
        process.exitCode = await fidelityLogin(providers[1] ?? "", root, options)

        return
      }

      process.exitCode =
        options.sweep === true
          ? await sweepCommand({ providers, root, yes: options.yes === true })
          : await fidelityCommand({
              providers,
              root,
              ...(options.updateGolden !== undefined && { updateGolden: options.updateGolden }),
              ...(options.fromOpenapi !== undefined && { fromOpenapi: options.fromOpenapi }),
              ...(options.offline !== undefined && { offline: options.offline }),
              ...(options.keep !== undefined && { keep: options.keep }),
            })
    },
  )

program
  .command("guide")
  .description("list task guides, or print one")
  .argument("[topic]", "a guide's topic; without one, the list")
  .action(async (topic: string | undefined) => {
    const { guideIndex, readGuide } = await import("@danwo/skill")

    console.log(topic === undefined ? guideIndex() : readGuide(topic).trimEnd())
  })

program
  .command("device")
  .description(
    "check this machine for mobile testing: Android (SDK, adb, emulator, rootable images, AVDs, JDK) and, on a Mac, iOS (Xcode, simctl, runtimes, CocoaPods)",
  )
  .addArgument(new Argument("<action>").choices(["doctor"]))
  .addOption(
    new Option("--platform <platform>", "check one platform only").choices(["android", "ios"]),
  )
  .action(async (_action: string, options: { platform?: "android" | "ios" }) => {
    const { deviceDoctor } = await import("@danwo/device")
    const checks = await deviceDoctor(undefined, {
      ...(options.platform !== undefined && { platform: options.platform }),
    })
    const platforms = [...new Set(checks.map((check) => check.platform))]

    for (const platform of platforms) {
      if (platforms.length > 1) console.log(platform === "ios" ? "iOS" : "Android")
      for (const check of checks.filter((each) => each.platform === platform))
        console.log(`${check.status.padEnd(4)}  ${check.name}: ${check.detail}`)
    }

    /* Without --platform, a machine ready for one platform passes. */
    const broken = platforms.filter((platform) =>
      checks.some((check) => check.platform === platform && check.status === "fail"),
    )

    process.exitCode = broken.length > 0 && broken.length === platforms.length ? 1 : 0
  })

/** What `build-android` and `build-ios` both report. */
interface AppBuild {
  readonly cached: boolean
  readonly durationMs: number
  readonly log: string
}

/** The options every build command takes, and the ones a platform adds (`--scheme`, `--variant`). */
interface BuildFlags {
  readonly force?: boolean
  readonly verbose?: boolean
  readonly [flag: string]: string | boolean | undefined
}

/**
 * Registers `danwo <name> [project]`: `build` makes (or reuses) the build from the project and the
 * flags, `where` says where it is and what it is called. `flags` adds the platform's own options.
 */
function buildCommand<B extends AppBuild>(
  name: string,
  description: string,
  flags: readonly (readonly [string, string])[],
  build: (project: string, flags: BuildFlags, onLine?: (line: string) => void) => Promise<B>,
  where: (build: B) => string,
): void {
  const command = program
    .command(name)
    .description(description)
    .argument(
      "[project]",
      "the app's folder: an Expo app, a native project or a Flutter app (found from what it holds)",
      ".",
    )
    .option("--force", "build again even when the sources are unchanged")
    .option("--verbose", "print the build tools' output")

  for (const [flag, about] of flags) command.option(flag, about)

  command.action(async (project: string, options: BuildFlags) => {
    const done = await build(
      resolvePath(project),
      options,
      options.verbose === true ? (line: string) => console.log(line) : undefined,
    )

    console.log(
      done.cached
        ? `reused ${where(done)}`
        : `built ${where(done)} in ${Math.round(done.durationMs / 1000)} s (log: ${done.log})`,
    )
  })
}

/** A string flag's value, if it was given. */
function flagOf(flags: BuildFlags, name: string): string | undefined {
  const value = flags[name]

  return typeof value === "string" ? value : undefined
}

buildCommand(
  "build-android",
  "build the danwo build of an app as an APK: an Expo app (release, trusting danwo's per-run CA), a Gradle project (`./gradlew assemble<Variant>`, debug-signed, with danwo's network config added for the build) or a Flutter app (`flutter build apk`); unchanged sources reuse the kept build",
  [["--variant <variant>", "a Gradle project's variant to assemble (default release)"]],
  async (project, flags, onLine) => {
    const variant = flagOf(flags, "variant")

    return (await import("@danwo/expo")).buildAndroid({
      project,
      force: flags.force === true,
      ...(variant !== undefined && { variant }),
      ...(onLine !== undefined && { onLine }),
    })
  },
  (build) => (build.package === undefined ? build.apk : `${build.apk} (${build.package})`),
)

buildCommand(
  "build-ios",
  "build the danwo build of an app for the iOS Simulator, unsigned, plain HTTP allowed for the proxy: an Expo app (Release), an Xcode workspace or project (`xcodebuild`, the scheme found or --scheme) or a Flutter app (`flutter build ios --simulator`); unchanged sources reuse the kept build",
  [
    [
      "--scheme <scheme>",
      "a native project's scheme (default: its only one, or the project's name)",
    ],
    ["--configuration <name>", "a native project's build configuration (default Release)"],
  ],
  async (project, flags, onLine) => {
    const scheme = flagOf(flags, "scheme")
    const configuration = flagOf(flags, "configuration")

    return (await import("@danwo/expo")).buildIos({
      project,
      force: flags.force === true,
      ...(scheme !== undefined && { scheme }),
      ...(configuration !== undefined && { configuration }),
      ...(onLine !== undefined && { onLine }),
    })
  },
  (build) => (build.bundleId === undefined ? build.app : `${build.app} (${build.bundleId})`),
)

try {
  await program.parseAsync()
} catch (error) {
  process.stderr.write(`danwo: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = exitCodeForError(error)
}
