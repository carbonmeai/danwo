<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/svg/danwo-lockup-horizontal-on-dark.svg">
    <img src="brand/svg/danwo-lockup-horizontal-on-light.svg" alt="dánwò" height="64">
  </picture>
</h1>

**dánwò** (`danwo`) is an open-source testing framework that drives your app through its UI like a user, and then checks everything that happened behind it.

Coding agents made writing code cheap; verifying it is now the bottleneck. A test that clicks "Pay" and sees "Thank you" proves little: was the card charged once, did the webhook arrive, was the email sent, does the ledger add up? danwo answers one question per change: **what did this break, and how sure are we?**

- **It drives the app** in a browser or on an Android device, with locators, plain-English agent steps, or both. Agent steps are recorded once and replayed after that with no model calls.
- **It emulates the services behind the app.** Stripe, Resend, S3, Google, Microsoft, Slack, GitHub, Clerk, Auth0, Composio, Pusher, Novu, Tiptap, the model APIs and more answer from local emulators behind an egress proxy, so the app needs no code changes and no sandbox keys. Each emulator is checked against the real API.
- **It breaks the run on purpose.** `danwo matrix` records one clean run, then replays it once per fault the app could meet: declined cards, 500s, timeouts, duplicate or forged webhooks, double-submits, lost database commits, time jumps. An invariant judges every trial.
- **It explains every run.** A flight record keeps the video, each step, every provider call and webhook, the database statements and the emulators' state, with secrets redacted, in a dashboard, a GitHub Check and a pull request comment, and over MCP for coding agents.

## Quickstart

In your app's folder:

```sh
npx danwo init
```

`danwo init` looks at the project (package manager, framework, dev command, the providers it
uses) and asks what to set up:

- **What tests drive**: a browser (Playwright), an Android device (Expo and React Native, with a
  check of this machine's Android tools), both, or the app's HTTP API only.
- **The model for agent steps**: the Vercel AI Gateway (one key for every provider), Anthropic,
  OpenAI or Google directly, OpenRouter, an OpenAI-compatible server (Ollama, LM Studio, your
  own), or none. It writes only the key's variable name, to `.env.example`, and says whether the
  key is already set.
- **Which providers to emulate**: the ones it found in the dependencies and environment files
  are ticked.
- **Which coding agents to teach**: Claude Code, Cursor, Codex or the shared `.agents/skills`,
  with danwo's MCP server registered for them.

It writes `danwo.config.ts`, a `tests/example.danwo.ts` that passes on a fresh project, a
`test:danwo` script and a `.gitignore` entry, and installs what the files import. Run it again
and it changes nothing; a config you edited is shown as a diff and replaced only if you say so
(`--force` without prompts). Then:

```sh
npm run test:danwo                                  # danwo starts the dev server through its proxy
APP_URL=http://localhost:3000 npm run test:danwo    # or test an app that already runs
```

For CI and coding agents, `danwo init --yes` asks nothing and takes flags for every choice:
`--engine`, `--model-source`, `--model`, `--base-url`, `--key-env`, `--providers`, `--skills`,
`--no-mcp`, `--dev-command`, `--app-url`, `--skip-install` and `--force`. Without a terminal it
behaves the same.

## What works today

- **`danwo test`**: tests in `*.danwo.ts` files with `test`, `describe`, hooks, fixtures and invariants, run in parallel workers. Steps use locators (`screen.getByRole(...)`) or an AI agent (`agent.act`, `agent.assert`, `agent.extract`) whose verified steps replay with zero model calls.
- **`danwo matrix`**: reruns a test once per planned fault (provider errors, dropped connections, slow responses, duplicate, late, forged or stale webhooks) and per race (a double-submitted form, concurrent users, webhooks before the redirect back, reordered webhooks, a slow provider call the app retries) and judges each run by the test's invariant.
- **Emulators**: Stripe, Resend, S3 and Tigris, Auth0 (Universal Login with signup, MFA and social buttons, PKCE, refresh rotation, client credentials, the Management API v2), Google (sign-in, Gmail, Calendar, Drive), Microsoft (sign-in, Outlook mail and calendar, OneDrive, Graph change notifications), Slack, GitHub and Twilio (messages, status callbacks, incoming texts, Verify), each checked against the official SDK; Flutterwave (Standard checkout with its test cards, verification, refunds, plans, transfers, virtual accounts) is checked against its v3 API docs. Clerk (a development instance: the Backend API, sessions and organizations checked against `@clerk/backend`, and the Frontend API that the real ClerkJS `<SignIn/>` signs in through, with a password or an emailed code). Composio (toolkits, tool execution, auth configs, connected accounts with hosted links, triggers and signed webhooks, checked against `@composio/core`), whose Gmail, Calendar, Drive, Slack, GitHub and Outlook tools can act on the Google, Slack, GitHub and Microsoft emulators. Pusher (Channels with the `pusher-js` socket, presence and client events, Beams), Novu (workflows run through the app's `@novu/framework` bridge, the Inbox and its socket) and Tiptap Cloud collaboration (Hocuspocus sync and the documents API), with the browser's sockets routed through the proxy. Other AWS services can be forwarded to MiniStack.
- **Model APIs**: OpenAI, Anthropic, the Vercel AI Gateway, Gemini, Perplexity and Bedrock answered from scripts (or recordings of the real provider), streamed when asked, with model faults for `danwo matrix`: rate limits, outages, refusals, empty, cut-off and filtered answers, malformed tool calls and broken streams. See `danwo guide llm`.
- **Egress proxy**: routes real provider hostnames to emulators, logs every exchange and applies faults.
- **The app's own database and cache**: TCP fault proxies in front of Postgres and Redis read the wire protocol, label each statement or command (`COMMIT`, `UPDATE orders`, `INCR rate:*`) and let `danwo matrix` fault it: a COMMIT whose reply is lost after the server committed, serialization failures and deadlocks, a database that is down or full, slow queries, and Redis OOM, LOADING and READONLY. See `danwo guide infrastructure`.
- **Integration lint**: every run is reviewed from the calls and webhooks it made, with no invariant to write: money moved without an idempotency key, webhooks accepted unsigned or stale, payments trusted on the redirect, secret keys in the browser or in URLs, retries that ignore `Retry-After` or create twice.
- **Flight recorder**: for failed runs, an offline HTML report with steps, screenshots, network exchanges, webhook deliveries and emulator state, with secrets redacted.
- **Visual checks**: `toHaveScreenshot` with baselines and masks.
- **Saved sessions**: sign in once per worker and start every test that names the session from that browser state (cookies, localStorage, IndexedDB); it is set up again when the environment resets or its check fails.
- **Time travel**: `time.travel({ days: 30 })` moves the app's clock, every emulator's clock and the page's clock together, so trials end, subscriptions renew and retries run in seconds; faults still apply to what falls due afterwards. See `danwo guide time`.
- **Android apps**: the same tests, invariants and fault matrix against a React Native or Expo app on an Android emulator bound to the run's proxy and CA, Custom Tabs included. See `danwo guide mobile`.
- **`danwo record`**: use the app in a browser and get a test: a locator line per action, what each action caused behind the app, and an invariant drafted from it.

## Packages

| Package             | What it is                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@danwo/sdk`        | The public test API                                                                                                             |
| `@danwo/cli`        | `danwo test`, `matrix`, `record`, `show`, `serve`, `mcp`, `init`, `spec`, `guide`, `fidelity`, `device doctor`, `build-android` |
| `@danwo/recorder`   | Writes tests: records someone using the app; locators and the writer                                                            |
| `@danwo/runner`     | Browser sessions, the agent, replay, workers and the flight recorder                                                            |
| `@danwo/matrix`     | The fault matrix                                                                                                                |
| `@danwo/data`       | Snapshots of the app's Postgres, SQLite and Redis for fast matrix trials                                                        |
| `@danwo/infra`      | Fault proxies in front of the app's Postgres and Redis, for data faults in the matrix                                           |
| `@danwo/proxy`      | The egress proxy                                                                                                                |
| `@danwo/emulators`  | Provider emulators                                                                                                              |
| `@danwo/fidelity`   | Checks the emulators against the real providers by structure                                                                    |
| `@danwo/github`     | Reports runs to GitHub from Actions: a check run, a pull request comment and the job summary                                    |
| `@danwo/skill`      | The coding-agent skill, task guides and the generated capability spec                                                           |
| `@danwo/mcp`        | An MCP server for coding agents: run, explain and write danwo tests                                                             |
| `@danwo/playwright` | danwo's environments, faults, invariants and matrix for Playwright Test                                                         |
| `@danwo/dashboard`  | `danwo serve`: runs, flight records, matrix grids and flaky tests                                                               |
| `@danwo/ui`         | The design system the dashboard is built with                                                                                   |
| `@danwo/device`     | Android emulators bound to the run's proxy and CA, driven through agent-device                                                  |
| `@danwo/expo`       | The danwo build of an Expo app (`danwo build-android`)                                                                          |

See `examples/shop` for a small app tested with `danwo test` and `danwo matrix`, and
`examples/shop-playwright` for the same test in Playwright Test. `examples/shop-mobile` is an
Expo app that buys the credits through Stripe Checkout in a Custom Tab, tested on an Android
emulator.

## Snapshots of the app's data

`danwo matrix` restores each worker's environment before every trial. The emulators restore from
memory; for the app's own data stores, `@danwo/sdk` exports ready-made snapshots to call from the
environment's `snapshot()` and `restore()`:

```ts
const url = await postgresWorkerDatabase(process.env.DATABASE_URL ?? "", workerIndex) // `<db>_w0`…
const db = postgresSnapshot({ url }) // also sqliteSnapshot({ file }) and redisSnapshot({ url })

return {
  // …baseUrl, proxy, fixtures and reset as usual
  snapshot: () => db.snapshot(),
  restore: () => db.restore(),
  close: () => db.close(),
}
```

A Postgres restore puts a fresh copy of the snapshot in place in tens of milliseconds; the app's
pool must reconnect when its connections are closed. See `danwo guide matrix` for the details and
what each store needs.

## Record a test

`danwo record [path]` starts the project's environment and opens the app in a browser behind the
proxy. Use the app; the danwo toolbar in the corner stops the recording, adds an assertion (press
Assert, then click the element) and adds a note. On Stop (or Ctrl-C) it writes a new test, never
replacing a file:

- one locator line per action, preferring `getByRole` with a name, then a label, a test id, then
  text; each one finds only that element, and none holds a value that changes between runs;
- a `// →` line after each action with the provider calls and webhooks it caused;
- password fields as `secret("password")`, never their value, with the config line to add;
- a code or link the app emailed as `await mail.code(…)` / `mail.link(…)`, so replays read the new
  one from the emulator;
- an invariant drafted from what it saw behind the app. After a Stripe checkout, a number the app
  showed stays in step with the checkouts Stripe was paid for; a Slack message or GitHub comment
  sent in answer to a webhook is sent at most as often as recorded. Otherwise the file lists what
  it saw so you can write the rule.

Then run what it prints: `danwo matrix tests/recorded.danwo.ts`. `--out` and `--name` set the file
and the test's title.

## Use danwo from Playwright Test

Existing Playwright suites keep their tests and gain danwo's backend: the emulators behind an
egress proxy, faults, invariants and the fault matrix. Import `test` and `expect` from
`@danwo/playwright` instead of `@playwright/test`:

```ts
// playwright.config.ts
export default defineConfig({ use: { danwoConfig: "danwo.config.ts" } })

// tests/buy.spec.ts
import { expect, testWith } from "@danwo/playwright"
import type { StripeFixtures } from "@danwo/sdk"

const test = testWith<StripeFixtures>() // types `danwo.stripe`

test.invariant(async ({ danwo, baseURL }) => {
  // Runs after every test in the file, however its body went.
})

test("buys credits", async ({ page, danwo }) => {
  danwo.inject("duplicate on webhook checkout.session.completed") // optional: a live fault
  await page.goto("/")
  // …
  await danwo.settle() // deliver pending webhooks
})
```

- Each Playwright worker starts the config's `environment()` once (or the `danwoEnvironment`
  option's) and launches its browser behind the environment's proxy.
- `danwo` holds the environment's fixtures (`danwo.stripe`, `danwo.slack`, …), `exchanges()` and
  `deliveries()` since the test began, `settle()`, `inject(label)` and `clearFaults()`.
- A failed test gets a `danwo flight record` attachment: the calls, webhooks and emulator state,
  redacted like danwo's own records.
- `npx danwo-playwright matrix tests/buy.spec.ts [--grep …] [--faults …]` runs the test clean,
  plans faults from its calls and webhooks, and runs it once per fault in a fresh Playwright
  process. Faulted runs are judged by the invariant; each trial's results are kept under
  `test-results/danwo-matrix/`. Status faults get their provider's error body; the danwo config's
  `matrix.webhookFaults` and `matrix.outboundFaults` choose what is planned.

## Android apps

```ts
test("buys 500 credits", async ({ screen, expect }) => {
  await screen.getByTestId("buy").tap()
  await screen.getByLabel("Email").fill("buyer@example.com") // Stripe Checkout, in a Custom Tab
  await screen.getByRole("button", { name: "Pay $5.00" }).tap()
  await expect(screen.getByTestId("credits")).toHaveText("Credits: 500")
})
```

`withAndroidDevice(env, { avd, app })` from `@danwo/device` boots an emulator (or uses a running
one), roots it, trusts the run's CA, routes its traffic through danwo's proxy with `adb reverse`,
installs the app, and gives each test a fresh launch. Locators resolve on the accessibility tree:
React Native's `testID`, roles, labels and text. `danwo build-android` makes the release APK of an
Expo app that trusts user CAs, cached by a hash of its sources; `danwo device doctor` checks the
machine. `agent.act`, `extract`, `assert` and `waitFor` run on the device too, with replay at no
model calls, relocation, strict stop, effects and a vision fallback on screenshots; each worker
boots its own emulator from a snapshot, so the fault matrix runs on several at once. See
`danwo guide mobile`.

## Vision

The agent reads the page as text first. For what text cannot show (a canvas, an icon button with
no name, a widget in a frame it cannot list) it looks at a screenshot with numbered marks and acts
there; each such action replays with no model call by finding its place by how it looks. Set
`vision: "auto" | "always" | "off"` in the config (default `auto`), or `{ mode, model }` for a model
of its own that places described targets. `act`, `assert` and `extract` take `{ vision }` per call.

## Time travel

```ts
test("a trial turns into a paid plan", async ({ app, screen, expect, time, settle }) => {
  // …start the trial…
  await time.travel({ days: 15 })
  await settle()
  await app.open("/account")
  await expect(screen.getByRole("status")).toHaveText("Plan: active")
})
```

What moves:

- **The app's clock.** Node and Bun apps started with `proxy.env()` run their `Date` ahead by the
  travelled offset, through the proxy's preload. Their timers stay on real time, so sockets,
  retries and pools keep working.
- **The emulators' clocks.** They play renewals, retries and expiries in order, each step's
  webhooks landing before the next.
- **The page's clock.** It jumps too.

Time only moves forward, and each jump is a step in the flight record. `danwo matrix` faults the
webhooks that fall due after a jump like any other.

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

## GitHub Checks and the pull request comment

In GitHub Actions, `--reporter github` turns a run into a check run on the commit (the pull
request's head on `pull_request` events). The check carries pass/fail counts, a row per failing
test or fault, and an annotation on the test file line each failure went through. The same summary
goes to the job summary. Outside Actions, or when the token may not write checks, the reporter says
so and the run's exit code is unchanged.

On a pull request the reporter also keeps one comment up to date: the headline counts, duration,
model spend and commit; a row per test; each failure folded with its failing step, error class,
last provider calls, faults and flight record; flaky tests folded away; and a section per
`danwo matrix` test with its invariant's verdict and the faults that broke it. Every run edits the
same comment, sections from older commits are dropped, and shards leave it to `danwo merge-reports`.
Test names link to `DANWO_REPORT_URL` when the report is published. Turn it off with
`--no-pr-comment`, `DANWO_PR_COMMENT=off` or `github({ prComment: false })`; it needs
`pull-requests: write`.

```yaml
permissions:
  checks: write
  pull-requests: write
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

## CI

- **Defaults with `CI` set** (or `--ci`): one retry, a read-only replay cache, and `.only` refused
  with exit 2 naming the file and line. `--max-failures n` stops starting test files after `n`
  failed tests.
- **Flaky tests**: a test that fails then passes is reported once as flaky, in the summary, the
  GitHub check and `danwo show --format md`. `danwo test --last-failed` reruns what failed in the
  latest run and merges into it.
- **Sharding**: `danwo test --shard i/n` on each machine, then `danwo merge-reports` (with
  `--reporter github` or `--reporter junit`) over the gathered `.danwo/results/shard-*.json`.
- **JUnit**: `--reporter junit` writes `.danwo/junit.xml` for CI systems other than GitHub.
- **Change impact**: `danwo test --changed --since origin/main` runs the tests a change can affect:
  through the test files and what they import, and through the config's `impact.rules`, which map
  the app's own source globs to the pages, hosts, calls and webhooks tests touched (recorded per
  test in `.danwo/impact.json`). Unmapped changes run everything; docs run nothing. `danwo impact
  <files…>` explains the selection.

`danwo guide ci` has the details and a sharded workflow.

## Integration lint

`danwo test` and `danwo matrix` lint each run's provider calls and webhooks and print what they
found after the results:

```text
integration lint: 2 errors, 1 warning
  error   payments/unconfirmed  the test passed after a stripe payment that the app never confirmed: no verify call and no webhook came after it
          at tests/buy.danwo.ts:6; Fulfil from the provider's signed webhook, or verify the payment with the provider's API on the redirect, before granting anything.
```

Findings also go into flight records, GitHub check annotations (warning level) and JUnit. They do
not fail a run unless the config says so:

```ts
lint: { rules: { "stripe/idempotency-key": "error" }, failOn: "error" },
```

`--no-lint` skips it for one run; `danwo lint [run]` runs the rules again over a recorded run;
`danwo spec --topic lint` lists every rule and `danwo guide lint` explains them. Some rules speak
only about matrix trials that forged, aged or delayed a webhook.

## Coding agents (MCP)

`danwo mcp` serves the project in the current folder to a coding agent over MCP (stdio).
`npx danwo init` registers it for the agents you pick: Claude Code (`.mcp.json`), Cursor
(`.cursor/mcp.json`) and Codex (`.codex/config.toml`), merging into files that exist
(`--no-mcp` skips it). By hand, with Claude Code:

```bash
claude mcp add danwo -- npx danwo mcp
```

### Skill, spec and guides

`danwo init` also installs danwo's skill (`SKILL.md`) into `.claude/skills/danwo` (Claude Code)
and `.agents/skills/danwo` (Codex, Cursor and other agents that read the shared folder). It
teaches the inspect → check locators → scaffold → run → failure page → fix → invariant → matrix
loop and how to triage each error code. A copy you edited is kept; `--skills none` skips it.

- `danwo spec [--topic <topic>] [--json]`: everything this danwo provides, generated from its code
  each time: the test API, fixtures, locators and matchers, agent methods, secrets, config keys,
  environments and seed shapes, emulator helpers, fault labels per provider, commands, error codes
  and cache outcomes.
- `danwo guide [topic]`: short task guides (first test, locators or agent, the matrix, providers,
  email and OTP, sessions, secrets, debugging, CI, Playwright).

Over MCP they are the resources `danwo://spec` and `danwo://guide/<topic>`, and `show_run` with
`format: "md"` returns the failure page.

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

## Dashboard

`danwo serve` starts a local dashboard on `http://127.0.0.1:4310/` (`--port`, `--open`) for the
project around the current folder. It reads `.danwo` and never writes to it:

- **Runs**: every `danwo test` and `danwo matrix`, with pass/fail/flaky/not-judged counts, time,
  model calls and cost.
- **A run**: its tests with status, retries and cache use, or its faults as a grid where failed,
  not-judged and invalid trials read apart.
- **A flight record**: steps with screenshots, cache outcomes and expected vs observed effects,
  console errors, redacted network calls, webhook deliveries, emulator state and the failure page.
- **Insights** (flaky, slowest and costliest tests across runs) and **Impact** (what each test
  touches behind the app).

Every run adds a redacted summary to `.danwo/history/`. See `danwo guide dashboard`.

## Benchmark

`benchmarks/` holds a benchmark app with eleven scenarios (sign-up with an emailed code, a
Stripe checkout with a bank approval step, a validated form, a sortable paged table, a dialog, an
upload, a cross-origin widget, a canvas, a Slack notification, webhook-driven order status and a
slow report) and eight bugs it can be started with. Each scenario is written three ways: locators
only, the agent alone, and mixed. `bun run bench` measures the pass rate on the correct app, how
many planted bugs make the right test fail, false failures, model calls and cost on the first run
and on the replay, and how many provider bugs `danwo matrix` catches.

```bash
bun run bench          # no model: locators, the UI bugs, the matrix; agent and mixed replay
bun run bench --live   # every style with a real model (AI_GATEWAY_API_KEY; a dollar or two)
```

Live runs take `AI_GATEWAY_API_KEY` from the environment, else from a git-ignored `.env`, else
`DANWO_FIDELITY_AI_GATEWAY_KEY` from `.env.fidelity`; neither file has to exist.

Results land in `benchmarks/results/`. The agent and mixed recordings are committed, so the
benchmark replays them with no model calls and fails if a change makes a replay diverge.

## Emulator fidelity

`danwo fidelity` runs a scenario suite per provider against the emulator and the provider's own
sandbox or test mode, and compares the answers by structure: statuses, error codes and the JSON's
keys, types and fixed values, leaving ids, times and secrets out. Each difference prints classified
as a missing field, extra field, type mismatch, status mismatch, error-code mismatch or ordering.

```bash
danwo fidelity                         # emulators against the committed goldens (in bun run check)
danwo fidelity stripe --update-golden  # with DANWO_FIDELITY_STRIPE_KEY=sk_test_…: record the sandbox
DANWO_FIDELITY_PUBLIC=1 danwo fidelity slack github google microsoft   # public endpoints, no keys
danwo fidelity gateway                 # with DANWO_FIDELITY_AI_GATEWAY_KEY: the AI Gateway, a fraction of a cent
```

Goldens live in `fidelity/<provider>.json` and hold structure only; accepted differences, each with
its reason, are in `fidelity/known-differences.json`. Only test and sandbox keys run: a live-looking
key stops the run. Keys come from the environment, then a git-ignored `.env.fidelity`, then `.env`;
neither file has to exist. The gateway suite takes `DANWO_FIDELITY_AI_GATEWAY_KEY`, else
`AI_GATEWAY_API_KEY`. See
`danwo guide fidelity`.

## Development

Node 24 and bun.

```bash
bun install
bun run check       # format, lint, fallow, typecheck, unit tests
bun run test:slow   # browser and CLI tests
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, see [SECURITY.md](SECURITY.md).

## Status

Early. APIs will change.

## License

The code is licensed under the [Apache License 2.0](LICENSE). The dánwò name and logo in [`brand/`](brand/) are trademarks of Carbonme Inc and are not covered by that licence; see [TRADEMARKS.md](TRADEMARKS.md).
