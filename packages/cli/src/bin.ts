#!/usr/bin/env node
/*
 * `danwo test` and `danwo matrix`. Runs under Node >= 24 with native type stripping; the runner
 * forks its workers with its own resolve hook.
 */
import "@danwo/runner/register"
import { github } from "@danwo/github"
import {
  type CacheAction,
  exitCodeForError,
  type RecordMode,
  type Reporter,
  runCache,
  runMatrix,
  runTests,
  showRun,
} from "@danwo/runner/runner"
import { Argument, Command, InvalidArgumentError, Option } from "commander"

/** Reporters by the names `--reporter` takes; the console's list output always runs. */
const REPORTERS: Readonly<Record<string, () => Reporter>> = { github: () => github() }

/** The reporters named by `--reporter`, comma-separated or repeated. */
function reportersOf(names: readonly string[] | undefined): Reporter[] {
  return (names ?? [])
    .flatMap((name) => name.split(","))
    .map((name) => name.trim())
    .filter((name) => name !== "" && name !== "list")
    .map((name) => {
      const make = REPORTERS[name]

      if (make === undefined) {
        throw new InvalidArgumentError(`unknown reporter "${name}" (known: list, github)`)
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

const reporterOption = () =>
  new Option(
    "--reporter <names...>",
    "reporters besides the console's list: github (a check run and job summary in GitHub Actions)",
  )

const program = new Command()
  .name("danwo")
  .description("Drive your app like a user, judge the layers below, and run the fault matrix.")

program
  .command("test")
  .description("run test files in worker processes")
  .argument("[patterns...]", "file paths or substrings narrowing the config's testMatch")
  .option("-w, --workers <n>", "worker processes", integerAtLeast(1))
  .option("-r, --retries <n>", "retries per test", integerAtLeast(0))
  .option("-g, --grep <regexp>", "only tests whose full title matches")
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
        config?: string
        record?: RecordMode
        updateSnapshots?: boolean
        reporter?: string[]
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

program
  .command("matrix")
  .description("record a clean run of one test, then replay it once per planned fault")
  .argument("<file>", "test file")
  .option("-g, --grep <regexp>", "selects the test when the file has several")
  .option("-f, --faults <regexp>", "only the planned faults whose labels match")
  .option("-w, --workers <n>", "worker processes", integerAtLeast(1))
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
        config?: string
        record?: RecordMode
        updateSnapshots?: boolean
        reporter?: string[]
      },
    ) => {
      const update = updateSnapshots ? { updateScreenshots: true } : {}
      const reporters = reportersOf(reporter)

      process.exitCode = (await runMatrix({ file, ...options, reporters, ...update })).code
    },
  )

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
    })
  })

program
  .command("init")
  .description(
    "register danwo's MCP server with Claude Code, Cursor and Codex in this project (.mcp.json, .cursor/mcp.json, .codex/config.toml)",
  )
  .option("--starter-config", "also write a starter danwo.config.ts when there is none")
  .action(async (options: { starterConfig?: boolean }) => {
    const { initProject, initReport } = await import("@danwo/mcp")
    const changes = await initProject({
      cwd: process.cwd(),
      starterConfig: options.starterConfig ?? false,
    })

    console.log(initReport(changes))
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
  .command("cache")
  .description("list, count or clear the replay cache's recordings")
  .addArgument(new Argument("<action>").choices(["ls", "stats", "clear"]))
  .option("-j, --journey <test-id>", "only the recordings of this test")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .action(async (action: CacheAction, options: { journey?: string; config?: string }) => {
    process.exitCode = await runCache(action, options)
  })

try {
  await program.parseAsync()
} catch (error) {
  process.stderr.write(`danwo: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = exitCodeForError(error)
}
