# Writing a first test

Set up a config, write one `*.danwo.ts` file, run it and read the result.

1. Run `danwo init` in the project. It detects the package manager, framework, dev command and
   the providers the app uses, asks what to set up, and writes `danwo.config.ts`, a passing
   `tests/example.danwo.ts` and a `test:danwo` script. A coding agent runs it without prompts:

   ```sh
   danwo init --yes --engine web --model-source gateway --providers stripe,resend --skills claude
   ```

   danwo needs Node.js 22.22.3 or a later 22, or 24.11.1 or newer; on any other Node every
   `danwo` command exits 1 with `danwo needs Node.js 22.22.3 or a later 22, or 24.11.1 or newer;
   this is Node.js v…`. init installs `@danwo/cli` and
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
   `npx @danwo/cli mcp --config <path>/danwo.config.ts`). For a browser engine, init then
   runs `danwo install-browser` with the project's package manager (`npx @danwo/cli install-browser`,
   `pnpm exec danwo install-browser`, …), which installs the Chromium build danwo's own
   `playwright-core` drives, once per machine (`--with-deps` on Linux for the system libraries,
   `--only-shell` for the smaller headless-only download in CI; `danwo record` needs the full
   browser). It keeps the browsers other Playwright installs use (`--no-remove`). Not
   `npx playwright install` or `npx playwright-core install`: they run whichever Playwright the
   project resolves first, whose Chromium revision may not match. A launch that finds no browser
   fails `BROWSER_FAILED` naming `npx @danwo/cli install-browser`.

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

   `browser: { contextOptions: { … } }` sets every browser context the run opens (each test's,
   each saved session's setup, each `users.open` person's, the MCP server's sessions):
   `reducedMotion` (`"reduce"`), `colorScheme` (`"light" | "dark" | "no-preference"`), `locale`
   (`"de-DE"`), `timezoneId` (`"Europe/Berlin"`), `viewport` (`{ width, height }` or `null`;
   default 1280×720), `httpCredentials` (`{ username, password, origin?, send? }`) and
   `extraHTTPHeaders` (sent to every host, providers' too). They are checked as the config loads:
   an unknown key, a time zone or locale that does not exist, or a bad header name fails with
   `CONFIG_INVALID` naming the key (`browser.contextOptions.timezoneId`).

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

Test files, `danwo.config.ts` and everything they import (installed packages aside) load under
Node's type stripping: types are removed, nothing is compiled, nothing is type-checked (run
`tsc --noEmit` for that). Not supported: `enum` (use `const X = { … } as const`), constructor
parameter properties (`constructor(private x: T)`: declare the field and assign it), `namespace`,
`<T>value` assertions (`value as T`), `import x = require()` / `export =`, and decorators. Imports
resolve as Node does, plus: an extensionless or `.js` relative specifier finds the `.ts` file or
`index.ts`, and a bare specifier no installed package answers is tried against the nearest
`tsconfig.json`'s `compilerOptions.paths` (with `baseUrl`, and configs it `extends` by a relative
path), for the project's own files only. A file that fails on any of this stops the run before
any test with `CONFIG_INVALID` (exit 2), naming the file and line, the feature and the plain form
to write; an alias that matches nothing says so.

A test body receives fixtures: `app` (open paths, the base URL), `screen` (locators), `expect`,
`agent` (plain-language steps), `secret` and `mail`. `test.describe`, `beforeEach`/`afterEach`,
`beforeAll`/`afterAll`, `test.only`, `test.skip` and per-test options (`retries`, `timeout`,
`session`) work as you would expect. Every `afterAll` of a file runs once its tests are done, also
when a `beforeAll` threw (the file's tests then do not run) and when an earlier `afterAll` threw;
the file fails with its first error, the other hooks' errors named after it
(`seeding failed (afterAll also failed: …)`), so teardown of what setup made outside the app
always happens.

A config key danwo does not know (`retires`, `testmatch`, `matrix.budjet`) is not an error, since
Node does not check the config's types, but `danwo test` and `danwo matrix` print a warning on
stderr for each, with the known key it most likely means:

```text
danwo: warning: unknown config key `retires` (did you mean `retries`?); danwo ignores it
```

Add an invariant when the test touches money, messages or other state behind the app:
`test(...).invariant(fn)` must hold however the body went, and `danwo matrix` judges every
faulted run by it (`danwo guide matrix`).

Exit codes: 0 all passed, 1 a test failed, 2 the config or a call is wrong, 3 the browser,
environment or model provider failed. `danwo spec --topic errors` lists every code.
