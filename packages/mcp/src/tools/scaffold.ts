/**
 * `scaffold_test`: writes a new test file from a description: its name, the page it starts on,
 * its steps as `agent.act` / `agent.assert` instructions or locator code, and an invariant stub
 * that fails until it is written. It never overwrites a file.
 */
import { join } from "node:path"

import { type InvariantDraft, renderTest, writeNewTest } from "@danwo/recorder"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { runJob } from "../jobs/run.ts"
import type { Project } from "../project.ts"
import { answer, text } from "../reply.ts"

const stepSchema = z.object({
  kind: z.enum(["act", "assert", "code"]),
  text: z
    .string()
    .describe(
      "an instruction for act/assert, or one line of test code, e.g. await screen.getByRole(...).click()",
    ),
})

type Step = z.infer<typeof stepSchema>

export interface TestDraft {
  readonly name: string
  readonly path: string
  readonly steps: readonly Step[]
  /** What must hold however the run went; undefined writes no invariant. */
  readonly invariant: string | undefined
}

function stepCode(step: Step): string {
  if (step.kind === "code") return step.text.trim()

  return `await agent.${step.kind}(${JSON.stringify(step.text)})`
}

/** The fixtures the body uses, so lazy fixtures the test never needs are not set up. */
function fixturesOf(steps: readonly Step[]): string[] {
  const code = steps
    .filter((s) => s.kind === "code")
    .map((s) => s.text)
    .join("\n")
  const uses = (name: string) => new RegExp(`\\b${name}\\b`).test(code)

  return [
    "app",
    ...(steps.some((s) => s.kind !== "code") ? ["agent"] : []),
    ...["screen", "expect", "secret"].filter(uses),
  ]
}

/** An invariant that fails until it is written, saying what it should check. */
function invariantStub(invariant: string): InvariantDraft {
  return {
    fixtures: [],
    body: [
      `/* ${invariant.replace(/\*\//g, "* /")} */`,
      `throw new Error(${JSON.stringify(`invariant not written yet: ${invariant}`)})`,
    ],
  }
}

/** The test file's source. */
export function testSource(draft: TestDraft): string {
  return renderTest({
    imports: [{ from: "@danwo/sdk", names: ["test"] }],
    name: draft.name,
    fixtures: fixturesOf(draft.steps),
    body: [`await app.open(${JSON.stringify(draft.path)})`, ...draft.steps.map(stepCode)],
    invariant: draft.invariant === undefined ? undefined : invariantStub(draft.invariant),
  })
}

export function registerScaffoldTool(server: McpServer, project: Project): void {
  server.registerTool(
    "scaffold_test",
    {
      description:
        "Write a new *.danwo.ts test under the project's testDir: a name, the page it opens, steps as agent.act/agent.assert instructions or locator code, and an invariant stub that fails until written. Never overwrites a file. Run it with run_tests afterwards.",
      inputSchema: {
        file: z
          .string()
          .describe("the new file, relative to the project's testDir, ending in .danwo.ts"),
        name: z.string().describe("the test's title"),
        path: z.string().optional().describe('the page the test opens first, default "/"'),
        steps: z.array(stepSchema).describe("the test body, in order"),
        invariant: z
          .string()
          .optional()
          .describe("what must hold however the run went (for danwo matrix); omit for none"),
      },
    },
    (args) =>
      answer(async () => {
        if (!args.file.endsWith(".danwo.ts")) throw new Error("a danwo test file ends in .danwo.ts")

        const { testDir } = await runJob(project.place, { kind: "config" })
        const path = project.inside(join(testDir, args.file))
        const draft = {
          name: args.name,
          path: args.path ?? "/",
          steps: args.steps,
          invariant: args.invariant,
        }

        await writeNewTest(path, testSource(draft))

        return text([`wrote ${project.relative(path)}`, "", testSource(draft)])
      }),
  )
}
