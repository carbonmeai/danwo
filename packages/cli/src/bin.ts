#!/usr/bin/env node
/*
 * `danwo test` and `danwo matrix`. Runs under Node >= 24 with native type stripping; the runner
 * forks its workers with its own resolve hook.
 */
import { resolve as resolvePath } from "node:path"

import "@danwo/runner/register"
import { github } from "@danwo/github"
import {
  type CacheAction,
  exitCodeForError,
  explainImpact,
  junit,
  lintRun,
  mergeReports,
  type RecordMode,
  type Reporter,
  runCache,
  runMatrix,
  runTests,
  showRun,
} from "@danwo/runner/runner"
import { Argument, Command, InvalidArgumentError, Option } from "commander"

import { cliCommands } from "./commands.ts"

/** Reporters by the names `--reporter` takes; the console's list output always runs. */
const REPORTERS: Readonly<Record<string, () => Reporter>> = {
  github: () => github(),
  junit: () => junit(),
}

/** The reporters named by `--reporter`, comma-separated or repeated. */
function reportersOf(names: readonly string[] | undefined): Reporter[] {
  return (names ?? [])
    .flatMap((name) => name.split(","))
    .map((name) => name.trim())
    .filter((name) => name !== "" && name !== "list")
    .map((name) => {
      const make = REPORTERS[name]

      if (make === undefined) {
        throw new InvalidArgumentError(`unknown reporter "${name}" (known: list, github, junit)`)
      }

      return make()
    })
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
    "flight recorder: keep what runs did (default: config, else on-failure)",
  ).choices(["on-failure", "always", "off"])

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
    "reporters besides the console's list: github (a check run and job summary in GitHub Actions), junit (.danwo/junit.xml)",
  )

const program = new Command()
  .name("danwo")
  .description("Drive your app like a user, judge the layers below, and run the fault matrix.")

withLintOptions(program.command("test"))
  .description("run test files in worker processes")
  .argument("[patterns...]", "file paths or substrings narrowing the config's testMatch")
  .option("-w, --workers <n>", "worker processes", integerAtLeast(1))
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
  .option("--ci", "CI defaults even without the CI variable: 1 retry, read-only cache, no .only")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .addOption(recordOption())
  .addOption(updateOption())
  .addOption(reporterOption())
  .action(
    async (
      patterns: string[],
      {
        updateSnapshots,
        reporter,
        ...options
      }: {
        workers?: number
        retries?: number
        grep?: string
        lastFailed?: boolean
        changed?: boolean
        since?: string
        shard?: string
        maxFailures?: number
        ci?: boolean
        config?: string
        record?: RecordMode
        updateSnapshots?: boolean
        reporter?: string[]
        lint?: boolean
      },
    ) => {
      process.exitCode = await runTests({
        patterns,
        ...options,
        reporters: reportersOf(reporter),
        ...(updateSnapshots && { updateScreenshots: true }),
      })
    },
  )

withLintOptions(program.command("matrix"))
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
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .addOption(recordOption())
  .addOption(updateOption())
  .addOption(reporterOption())
  .action(
    async (
      file: string,
      {
        updateSnapshots,
        reporter,
        ...options
      }: {
        grep?: string
        faults?: string
        workers?: number
        maxFailures?: number
        shuffle?: number
        config?: string
        record?: RecordMode
        updateSnapshots?: boolean
        reporter?: string[]
        lint?: boolean
      },
    ) => {
      const update = updateSnapshots ? { updateScreenshots: true } : {}
      const reporters = reportersOf(reporter)

      process.exitCode = (await runMatrix({ file, ...options, reporters, ...update })).code
    },
  )

program
  .command("merge-reports")
  .description("join the results of a split run (danwo test --shard i/n) into one report")
  .argument("[files...]", "results files (default: .danwo/results/shard-*.json)")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .addOption(reporterOption())
  .action(async (files: string[], options: { config?: string; reporter?: string[] }) => {
    process.exitCode = await mergeReports({
      files,
      ...(options.config !== undefined && { config: options.config }),
      reporters: reportersOf(options.reporter),
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
      commands: cliCommands(program),
    })
  })

program
  .command("init")
  .description(
    "register danwo's MCP server with Claude Code, Cursor and Codex in this project (.mcp.json, .cursor/mcp.json, .codex/config.toml) and install danwo's skill for them",
  )
  .option("--starter-config", "also write a starter danwo.config.ts when there is none")
  .option("--no-skill", "do not install danwo's skill into .claude/skills and .agents/skills")
  .action(async (options: { starterConfig?: boolean; skill: boolean }) => {
    const { initProject, initReport } = await import("@danwo/mcp")
    const changes = await initProject({
      cwd: process.cwd(),
      starterConfig: options.starterConfig ?? false,
      skill: options.skill,
    })

    console.log(initReport(changes))
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
    "check this machine for Android testing: SDK, adb, emulator, rootable images, AVDs, JDK",
  )
  .addArgument(new Argument("<action>").choices(["doctor"]))
  .action(async () => {
    const { deviceDoctor } = await import("@danwo/device")
    const checks = await deviceDoctor()

    for (const check of checks)
      console.log(`${check.status.padEnd(4)}  ${check.name}: ${check.detail}`)
    process.exitCode = checks.some((check) => check.status === "fail") ? 1 : 0
  })

program
  .command("build-android")
  .description(
    "build the danwo build of an Expo app as a release APK (trusting danwo's per-run CA); unchanged sources reuse the kept build",
  )
  .argument("[project]", "the Expo project's folder", ".")
  .option("--force", "build again even when the sources are unchanged")
  .option("--verbose", "print the build tools' output")
  .action(async (project: string, options: { force?: boolean; verbose?: boolean }) => {
    const { buildAndroid } = await import("@danwo/expo")
    const build = await buildAndroid({
      project: resolvePath(project),
      force: options.force === true,
      ...(options.verbose === true && { onLine: (line: string) => console.log(line) }),
    })

    console.log(
      build.cached
        ? `reused ${build.apk}`
        : `built ${build.apk} in ${Math.round(build.durationMs / 1000)} s (log: ${build.log})`,
    )
  })

try {
  await program.parseAsync()
} catch (error) {
  process.stderr.write(`danwo: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = exitCodeForError(error)
}
