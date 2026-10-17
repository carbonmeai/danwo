/**
 * danwo's MCP server: tools for coding agents to list, run and explain danwo tests, look at the
 * app as the agent sees it and write new tests; resources for the project's config and the
 * latest run; and a prompt that walks an agent through writing a test.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import type { ConfigSummary } from "./jobs/protocol.ts"
import { runJob } from "./jobs/run.ts"
import { Project } from "./project.ts"
import { loadRun } from "./records.ts"
import { SessionManager, type SessionLimits } from "./sessions/manager.ts"
import { registerInspectTool } from "./tools/inspect.ts"
import { registerMatrixTool } from "./tools/matrix.ts"
import { registerRunTools, runSummary } from "./tools/runs.ts"
import { registerScaffoldTool } from "./tools/scaffold.ts"
import { registerSessionTools } from "./tools/sessions.ts"
import { registerTestTools } from "./tools/tests.ts"

export interface DanwoServerOptions {
  /** The project folder; its nearest `danwo.config.*` is the project's config. */
  readonly cwd: string
  /** A config file, relative to `cwd`, instead of the nearest one. */
  readonly config?: string | undefined
  readonly version?: string
  /** How many live sessions may be open at once, and when an idle one closes. */
  readonly sessions?: SessionLimits
}

function configText(summary: ConfigSummary): string {
  return [
    `root: ${summary.root}`,
    `config: ${summary.file ?? "(none)"}`,
    `tests: ${summary.testDir} matching ${summary.testMatch.join(", ")}`,
    `app: ${summary.environment ? "started by the config's environment" : (summary.baseUrl ?? "(no baseUrl)")}`,
    `workers: ${summary.workers} · retries: ${summary.retries}`,
    `agent model: ${summary.model ?? "(none: agent.act and agent.assert are unavailable)"}`,
    `secrets (pass secret(name)): ${summary.secrets.join(", ") || "(none)"}`,
    `files (upload by name): ${summary.files.join(", ") || "(none)"}`,
    `replay cache: ${summary.cache ?? "(none)"}`,
  ].join("\n")
}

const WRITE_TEST_GUIDE = (goal: string) => `Write a danwo test for: ${goal}

1. Read the danwo://config resource to see where tests live and what the app runs against.
2. Walk the journey live: open_session, then act on the page with click, fill, fill_secret (by
   the secret's name), select and press, using refs from each answer. For every element a step
   uses, run check_locator with the locator you would write (prefer getByRole with a name, then
   getByLabel, getByText, getByTestId) until it matches exactly one element; keep the line it
   gives you.
3. Look behind the app: exchanges shows the provider calls the journey made, deliver_webhooks
   plays the webhooks they queued, and emulator_state shows what each provider now holds. Use
   them to describe the invariant: what must hold however the run went (for example, what the
   payment provider charged matches what the app granted). Optionally try a fault the matrix
   would inject with inject_fault and repeat the step. Then close_session.
4. Call scaffold_test with the steps (the checked locator lines; agent.act / agent.assert for
   steps no locator pins down) and the invariant.
5. Run it with run_tests. On a failure, read show_run for the failing step, the screen at failure
   and the network calls, and read_screenshot if the page itself matters. Fix the test (or report
   the app bug the test found) and run it again.
6. Replace the invariant stub with real checks, then run_matrix on the test to see it hold under
   provider faults.`

function registerContext(server: McpServer, project: Project): void {
  server.registerResource(
    "config",
    "danwo://config",
    {
      description: "The project's danwo config: where tests live, the app, model, secrets' names",
      mimeType: "text/plain",
    },
    async (uri) => {
      const summary = await runJob(project.place, { kind: "config" })

      return { contents: [{ uri: uri.href, text: configText(summary) }] }
    },
  )
  server.registerResource(
    "latest-run",
    "danwo://runs/latest",
    { description: "The newest recorded run: its failures explained", mimeType: "text/plain" },
    async (uri) => {
      const run = await loadRun(project)
      const summary = run === undefined ? "no recorded runs yet" : await runSummary(project, run)

      return { contents: [{ uri: uri.href, text: summary }] }
    },
  )
  server.registerPrompt(
    "write-danwo-test",
    {
      description: "Inspect the app, scaffold a danwo test, run it and fix it until it passes",
      argsSchema: { goal: z.string().describe("the user journey the test should cover") },
    },
    ({ goal }) => ({
      messages: [{ role: "user", content: { type: "text", text: WRITE_TEST_GUIDE(goal) } }],
    }),
  )
}

/** The server for one project, not yet connected to a transport. */
export function createDanwoServer(options: DanwoServerOptions): McpServer {
  const project = new Project(options.cwd, options.config)
  const server = new McpServer({ name: "danwo", version: options.version ?? "0.0.0" })
  const sessions = new SessionManager(project.place, options.sessions)
  const closed = server.server.onclose

  /* The client went away: its live sessions, with their apps and browsers, go too. */
  // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the SDK's protocol offers only this hook, and the previous handler is kept
  server.server.onclose = () => {
    closed?.()
    void sessions.closeAll()
  }

  registerSessionTools(server, sessions)
  registerTestTools(server, project)
  registerMatrixTool(server, project)
  registerRunTools(server, project)
  registerInspectTool(server, project)
  registerScaffoldTool(server, project)
  registerContext(server, project)

  return server
}
