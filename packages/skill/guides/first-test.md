# Writing a first test

Set up a config, write one `*.danwo.ts` file, run it and read the result.

1. Run `danwo init` in the project. It detects the package manager, framework, dev command and
   the providers the app uses, asks what to set up, and writes `danwo.config.ts`, a passing
   `tests/example.danwo.ts` and a `test:danwo` script. A coding agent runs it without prompts:

   ```sh
   danwo init --yes --engine web --model-source gateway --providers stripe,resend --skills claude
   ```

   danwo needs Node.js 24 or newer; on an older Node every `danwo` command exits 1 with
   `danwo needs Node.js 24 or newer; this is Node.js v…`. init installs `@danwo/cli` and
   `@danwo/sdk` as dev dependencies at the version of the danwo running it (`danwo --version`
   prints it), so a beta sets up that beta, not `latest`; a TypeScript project without
   `@types/node` also gets `@types/node@^24`, since danwo's declarations use Node's types.
   `--skip-install` installs nothing and prints the command to run. In a monorepo, run init in
   the app's package: it finds the workspace root (`pnpm-workspace.yaml`, or a `workspaces` field
   for npm, Yarn and Bun) and installs with the workspace's manager into that package (`pnpm add
   -D` there, `npm install -D … --workspace <path>` from the root; at the root itself `pnpm add -D
   -w` and Yarn 1's `-W`). A folder under the workspace that is not one of its packages is a
   project of its own. When the package has no agent folders (`.claude`, `.cursor`, `.codex`, …)
   but a folder above it in the workspace does, the skill and MCP server are written there, with
   an MCP command that finds the package's config (`pnpm --dir <path> exec danwo mcp`, else
   `npx @danwo/cli mcp --config <path>/danwo.config.ts`). For a browser engine, install
   the Chromium danwo drives once per machine with `npx playwright-core install chromium`
   (`--with-deps` on Linux), not `npx playwright install`, which can fetch a newer Playwright
   whose Chromium does not match; a launch that finds no browser fails `BROWSER_FAILED` naming
   that command.

   The config it writes starts the app with its dev command through danwo's proxy, with the
   chosen providers emulated (`APP_URL` set instead tests an app that already runs):

   ```ts
   import { appEnvironment, defineConfig, stripeService } from "@danwo/sdk"

   const app = process.env.APP_URL ?? { command: "npm run dev", url: "http://localhost:3000" }

   export default defineConfig({
     testDir: "tests",
     workers: 1,
     model: "anthropic/claude-sonnet-5",
     readiness: { mode: "page+backend", settle: true },
     environment: () => appEnvironment({ app, services: [stripeService()] }),
   })
   ```

   A config with only `baseUrl: "http://localhost:3000"` also works when the app already runs and
   nothing behind it needs emulating (`danwo guide providers` covers the rest).

   `model` takes an AI Gateway id (key in `AI_GATEWAY_API_KEY`) or any AI SDK model:
   `anthropic("claude-sonnet-5")` from `@ai-sdk/anthropic`, `openai(…)`, `google(…)`, or
   `createOpenAICompatible({ baseURL, apiKey })` for OpenRouter, Ollama or a server of your own.
   Only the gateway reports what a call cost; wrap another provider's model in
   `priced(model, { input, output })` (dollars per million tokens) to see spend and use dollar
   budgets.

2. Write `tests/home.danwo.ts`:

   ```ts
   import { test } from "@danwo/sdk"

   test("shows the plans", async ({ app, screen, expect }) => {
     await app.open("/")
     await screen.getByRole("link", { name: "Pricing" }).click()
     await expect(screen.getByRole("heading", { name: "Plans" })).toBeVisible()
   })
   ```

3. Run it: `danwo test` (all files) or `danwo test home` (paths containing "home").

A test body receives fixtures: `app` (open paths, the base URL), `screen` (locators), `expect`,
`agent` (plain-language steps), `secret` and `mail`. `test.describe`, `beforeEach`/`afterEach`,
`beforeAll`/`afterAll`, `test.only`, `test.skip` and per-test options (`retries`, `timeout`,
`session`) work as you would expect.

Add an invariant when the test touches money, messages or other state behind the app:
`test(...).invariant(fn)` must hold however the body went, and `danwo matrix` judges every
faulted run by it (`danwo guide matrix`).

Exit codes: 0 all passed, 1 a test failed, 2 the config or a call is wrong, 3 the browser,
environment or model provider failed. `danwo spec --topic errors` lists every code.
