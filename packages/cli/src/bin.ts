#!/usr/bin/env node
/*
 * `danwo test` and `danwo matrix`. Runs under Node >= 24 with native type stripping; the runner
 * forks its workers with its own resolve hook.
 */
import "@danwo/runner/register"
import { type RecordMode, runMatrix, runTests, showRun } from "@danwo/runner/runner"
import { Command, InvalidArgumentError, Option } from "commander"

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
  .action(
    async (
      patterns: string[],
      {
        updateSnapshots,
        ...options
      }: {
        workers?: number
        retries?: number
        grep?: string
        config?: string
        record?: RecordMode
        updateSnapshots?: boolean
      },
    ) => {
      process.exitCode = await runTests({
        patterns,
        ...options,
        ...(updateSnapshots && { updateScreenshots: true }),
      })
    },
  )

program
  .command("matrix")
  .description("record a clean run of one test, then replay it once per planned fault")
  .argument("<file>", "test file")
  .option("-g, --grep <regexp>", "selects the test when the file has several")
  .option("-w, --workers <n>", "worker processes", integerAtLeast(1))
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .addOption(recordOption())
  .addOption(updateOption())
  .action(
    async (
      file: string,
      {
        updateSnapshots,
        ...options
      }: {
        grep?: string
        workers?: number
        config?: string
        record?: RecordMode
        updateSnapshots?: boolean
      },
    ) => {
      const update = updateSnapshots ? { updateScreenshots: true } : {}

      process.exitCode = (await runMatrix({ file, ...options, ...update })).code
    },
  )

program
  .command("show")
  .description("print the path of a recorded run's report (the newest by default)")
  .argument("[run-id]", "a run under .danwo/runs")
  .option("-o, --open", "open the report in the browser")
  .option("-c, --config <path>", "config file (default: nearest danwo.config.ts)")
  .action(async (runId: string | undefined, options: { open?: boolean; config?: string }) => {
    process.exitCode = await showRun({ ...(runId !== undefined && { runId }), ...options })
  })

await program.parseAsync()
