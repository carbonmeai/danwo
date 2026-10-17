# danwo

An open-source QA platform for the agentic era, with a cloud offering and a self-hosted version.

Coding agents made writing code cheap; verifying it is now the bottleneck. danwo answers one question per change: **what did this break, and how sure are we?**

It drives the app through its UI like a user, while third-party services the app calls are emulated behind an egress proxy, so the app needs no code changes. Every run can be replayed deterministically, broken on purpose with a fault matrix, and explained by a flight recorder.

## What works today

- **`danwo test`**: tests in `*.danwo.ts` files with `test`, `describe`, hooks, fixtures and invariants, run in parallel workers. Steps use locators (`screen.getByRole(...)`) or an AI agent (`agent.act`, `agent.assert`, `agent.extract`) whose verified steps replay with zero model calls.
- **`danwo matrix`**: reruns a test once per planned fault (provider errors, dropped connections, slow responses, duplicate, late, forged or stale webhooks) and judges each run by the test's invariant.
- **Emulators**: Stripe, Resend, S3 and Tigris, Google (sign-in, Gmail, Calendar, Drive), Microsoft (sign-in, Outlook mail and calendar, OneDrive, Graph change notifications), Slack and GitHub, each checked against the official SDK. Other AWS services can be forwarded to MiniStack.
- **Egress proxy**: routes real provider hostnames to emulators, logs every exchange and applies faults.
- **Flight recorder**: for failed runs, an offline HTML report with steps, screenshots, network exchanges, webhook deliveries and emulator state, with secrets redacted.
- **Visual checks**: `toHaveScreenshot` with baselines and masks.
- **Saved sessions**: sign in once per worker and start every test that names the session from that browser state (cookies, localStorage, IndexedDB); it is set up again when the environment resets or its check fails.

## Packages

| Package            | What it is                                                            |
| ------------------ | --------------------------------------------------------------------- |
| `@danwo/sdk`       | The public test API                                                   |
| `@danwo/cli`       | `danwo test`, `danwo matrix`, `danwo show`, `danwo mcp`, `danwo init` |
| `@danwo/runner`    | Browser sessions, the agent, replay, workers and the flight recorder  |
| `@danwo/core`      | The fault matrix                                                      |
| `@danwo/proxy`     | The egress proxy                                                      |
| `@danwo/emulators` | Provider emulators                                                    |
| `@danwo/github`    | Reports runs to GitHub from Actions: a check run and job summary      |
| `@danwo/mcp`       | An MCP server for coding agents: run, explain and write danwo tests   |

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

`danwo mcp` serves the project in the current folder to a coding agent over MCP (stdio).
`npx danwo init` registers it for Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json`) and
Codex (`.codex/config.toml`), merging into files that exist; `--starter-config` also writes a
`danwo.config.ts` when there is none. By hand, with Claude Code:

```bash
claude mcp add danwo -- npx danwo mcp
```

### Live sessions

`open_session` opens the app in danwo's browser behind the project's environment (its app,
emulators and proxy, as a test worker would) and answers with the page's accessibility tree. The
agent then drives it step by step, with no model on danwo's side:

| Tool                                                                            | What it does                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `click`, `fill`, `fill_secret`, `press`, `select`, `check`, `hover`, `navigate` | Act on a ref from the latest snapshot (`e12`) or a locator (`getByRole("button", { name: "Pay" })`); answers with what changed on the page and the console errors, failed requests and dialogs since the last call |
| `snapshot`                                                                      | The whole page now, with refs                                                                                                                                                                                      |
| `check_locator`                                                                 | Whether a locator matches exactly one element: the line to paste, or why a test using it would fail and the nearest elements                                                                                       |
| `screenshot`                                                                    | The page or an element as an image, with password fields, filled secrets and secret text masked                                                                                                                    |
| `exchanges`                                                                     | What the app sent through the proxy and got back since the last look, with each call's route                                                                                                                       |
| `deliver_webhooks`                                                              | Delivers the webhooks the emulators queued and lists them                                                                                                                                                          |
| `emulator_state`                                                                | What each emulator holds now (Stripe objects, mail, Slack messages, S3 objects, sign-ins), redacted                                                                                                                |
| `inject_fault`, `clear_faults`                                                  | Arm a fault named as `danwo matrix` names them (`duplicate on webhook checkout.session.completed`); it fires once on the next match                                                                                |
| `start_recording`, `stop_recording`                                             | A screenshot after every action into `.danwo/sessions/<id>/`, and optionally a video (refused once a secret was filled: video can't mask)                                                                          |
| `close_session`                                                                 | Stops the session's browser, app and emulators                                                                                                                                                                     |

Each session has its own environment; up to four can be open at once (`danwo mcp --max-sessions`),
and a session with no calls for ten minutes, or whose client went away, closes by itself.

### Tests and runs

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
