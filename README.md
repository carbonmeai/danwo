# danwo

An open-source QA platform for the agentic era, with a cloud offering and a self-hosted version.

Coding agents made writing code cheap; verifying it is now the bottleneck. danwo answers one question per change: **what did this break, and how sure are we?**

It drives the app through its UI like a user, while third-party services the app calls are emulated behind an egress proxy, so the app needs no code changes. Every run can be replayed deterministically, broken on purpose with a fault matrix, and explained by a flight recorder.

## What works today

- **`danwo test`**: tests in `*.danwo.ts` files with `test`, `describe`, hooks, fixtures and invariants, run in parallel workers. Steps use locators (`screen.getByRole(...)`) or an AI agent (`agent.act`, `agent.assert`, `agent.extract`) whose verified steps replay with zero model calls.
- **`danwo matrix`**: reruns a test once per planned fault (provider errors, dropped connections, slow responses, duplicate, late, forged or stale webhooks) and judges each run by the test's invariant.
- **Emulators**: Stripe, Resend, S3 and Tigris, Google and Microsoft sign-in, each checked against the official SDK. Other AWS services can be forwarded to MiniStack.
- **Egress proxy**: routes real provider hostnames to emulators, logs every exchange and applies faults.
- **Flight recorder**: for failed runs, an offline HTML report with steps, screenshots, network exchanges, webhook deliveries and emulator state, with secrets redacted.
- **Visual checks**: `toHaveScreenshot` with baselines and masks.
- **Saved sessions**: sign in once per worker and start every test that names the session from that browser state (cookies, localStorage, IndexedDB); it is set up again when the environment resets or its check fails.

## Packages

| Package            | What it is                                                           |
| ------------------ | -------------------------------------------------------------------- |
| `@danwo/sdk`       | The public test API                                                  |
| `@danwo/cli`       | `danwo test`, `danwo matrix`, `danwo show`                           |
| `@danwo/runner`    | Browser sessions, the agent, replay, workers and the flight recorder |
| `@danwo/core`      | The fault matrix                                                     |
| `@danwo/proxy`     | The egress proxy                                                     |
| `@danwo/emulators` | Provider emulators                                                   |
| `@danwo/github`    | Reports runs to GitHub from Actions: a check run and job summary     |
| `@danwo/mcp`       | An MCP server for coding agents: run, explain and write danwo tests  |

See `examples/shop` for a small app tested with `danwo test` and `danwo matrix`.

## Saved sessions

Define a session in the config (or a test file with `test.session`) and name it where tests use it:

```ts
// danwo.config.ts
export default defineConfig({
  sessions: {
    ada: {
      async setup({ app, screen, secret }) {
        await app.open("/login")
        await screen.getByLabel("Email").fill("ada@example.com")
        await screen.getByLabel("Password").fill(secret("password"))
        await screen.getByRole("button", { name: "Sign in" }).click()
      },
      // Optional: runs when a test reuses the state; throwing sets the session up again.
      async check({ app, screen, expect }) {
        await app.open("/account")
        await expect(screen.getByRole("heading", { name: "Account" })).toBeVisible()
      },
    },
  },
})

// a test file
test.use({ session: "ada" }) // or test(title, { session: "ada" }, body); `false` opts out
```

The setup runs once per worker; its agent steps record and replay like any others. Every reset
of the environment (each `danwo matrix` trial) drops the kept state. The flight record notes
whether a test's session was created, reused or renewed; the state itself is never recorded.

## GitHub Checks

In GitHub Actions, `--reporter github` turns a run into a check run on the commit (the pull
request's head on `pull_request` events). The check carries pass/fail counts, a row per failing
test or fault, and an annotation on the test file line each failure went through. The same summary
goes to the job summary. Outside Actions, or when the token may not write checks, the reporter says
so and the run's exit code is unchanged.

```yaml
permissions:
  checks: write
  contents: read

steps:
  # checkout, Node 24, install, `npx playwright install --with-deps chromium`
  - run: npx danwo test --reporter github
    env:
      GITHUB_TOKEN: ${{ github.token }}
  - run: npx danwo matrix tests/buy-credits.danwo.ts --reporter github
    env:
      GITHUB_TOKEN: ${{ github.token }}
  - uses: actions/upload-artifact@v4
    if: ${{ !cancelled() }}
    with:
      name: danwo-runs
      path: .danwo/runs
```

The summary links to the `danwo-runs` artifact and names each failure's flight record in it. In a
config, add `reporters: [github({ artifact: "my-runs" })]` with `github` from `@danwo/github`.

## Coding agents (MCP)

`danwo mcp` serves the project in the current folder to a coding agent over MCP (stdio). With
Claude Code, from the project's folder:

```bash
claude mcp add danwo -- npx danwo mcp
```

The agent gets these tools:

| Tool              | What it does                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `list_tests`      | The project's tests by file, with skip/only and whether they declare an invariant                       |
| `run_tests`       | Runs all tests or some (files, grep, names): the failing step, error and test line, model calls, record |
| `run_matrix`      | The fault matrix on one test, optionally narrowed to some faults (`faults: "duplicate"`)                |
| `show_run`        | A recorded run's failures: steps, console errors, failed or faulted calls, webhooks and emulator state  |
| `read_screenshot` | The screen at failure, or after a step, as an image                                                     |
| `inspect_page`    | A page of the app as danwo's agent reads it (its accessibility tree), and trying a locator on it        |
| `scaffold_test`   | Writes a new `*.danwo.ts` from a name, steps and an invariant to fill in; never overwrites a file       |

It also offers the resources `danwo://config` and `danwo://runs/latest`, and a prompt,
`write-danwo-test`, that walks the agent from inspecting the app to a passing test. Runs stream
their progress and can be cancelled. Everything the server returns is redacted like the flight
recorder's records, and files are only read and written inside the project. Runs and the matrix can
take minutes: raise your client's tool timeout if it is short.

## Development

Node 24 and bun.

```bash
bun install
bun run check       # format, lint, fallow, typecheck, unit tests
bun run test:slow   # browser and CLI tests
```

## Status

Early. APIs will change.
