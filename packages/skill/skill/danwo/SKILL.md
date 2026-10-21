---
name: danwo
description: Write, run and fix danwo tests (`*.danwo.ts`) that drive a web app through its UI while emulated providers (Stripe, Resend, S3, Google, Microsoft, Slack, GitHub, Twilio) run behind it, and check invariants under the fault matrix. Use when the user asks to test a user journey, verify a UI change in the running app, reproduce a bug, debug a failing danwo test, or check how the app handles provider failures and duplicate webhooks.
---

# danwo

danwo drives the app like a user and judges what happened behind it: provider calls go through
an egress proxy to emulators, so a test can check both the screen and the backend, and
`danwo matrix` breaks one provider call or webhook at a time to check an invariant still holds.

Look things up rather than guessing: `danwo spec` lists every export, fixture, matcher, agent
method, config key, environment, emulator helper, fault label, command and error code, generated
from the installed version (`danwo spec --topic <topic>`, `--json`). `danwo guide` lists task
guides; `danwo guide <topic>` prints one.

## Workflow

When the project has danwo's MCP server (`danwo init` registers it), work against the live app:

1. Read `danwo://config` for where tests live, the app and the configured secrets' names.
2. `open_session`, then walk the journey with `click`, `fill`, `fill_secret` (by name), `select`
   and `press`, using refs from each answer. `click` takes `modifiers` (`Shift`, `ControlOrMeta`,
   `Alt`…), `button: "right"` and `double: true`; `drag` drops `target` on `to`. `upload` puts files into a file input (a project
   path, a `files` name from the config, or `{ name, text | base64 }`; a test then uploads them
   by their `files` name).
3. For every element a step needs, `check_locator` with the locator you would write until it
   matches exactly one element; keep the line it returns. Prefer `getByRole` with a name, then
   `getByLabel`, `getByText`, `getByTestId`.
4. Look behind the app: `exchanges` (provider calls), `deliver_webhooks`, `emulator_state`. Decide
   the invariant: what must hold however the run goes, comparing the app's state with the
   provider's (credits granted = payments captured; one email per order).
5. `close_session`, then `scaffold_test` with the checked lines, `agent.act`/`agent.assert` for steps
   no locator pins down, and the invariant.
6. `run_tests`. On failure, `show_run` with `format: "md"` gives the failure page: error code,
   test line, steps with cache outcomes, screen, failed provider calls, webhooks, emulator state.
   Fix the test, or report the app bug it found, and run again.
7. Replace the invariant stub with real checks, then `run_matrix` on the test.

Without MCP, the same loop runs on the CLI: write the test, `danwo test <file>`,
`danwo show --format md`, fix, `danwo matrix <file>`.

## Rules

- Never put secret values in tests, prompts or files: configure them under `secrets` and pass
  `secret(name)`; the agent and records only ever see the name.
- Use `unique(...)` for values that must be fresh each run (emails, usernames); recordings replay
  with the new value.
- Read emailed codes and links from the emulators (`mail.code(to)`, `mail.link(to)`), not from
  the screen.
- Don't add sleeps: readiness waits for the page and for the app's provider calls after every
  action; `settle()` plays pending webhooks when a test needs it.
- An invariant reads state; it does not repeat the body's clicks.

## Triage by error code

| Class or code                                                               | Next step                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOCATOR_NOT_FOUND`, `LOCATOR_AMBIGUOUS`                                    | Look at the screen at failure and the nearest candidates; fix the locator with `check_locator`                                                                                                                                                                |
| `EXPECTATION_FAILED`, `CLAIM_FAILED`                                        | Compare expected and received; decide whether the app or the test is wrong                                                                                                                                                                                    |
| `APP_ERROR`                                                                 | The app failed (5xx, uncaught error): an app bug to report or fix                                                                                                                                                                                             |
| `PROVIDER_ERROR`                                                            | A provider call failed and the app did not recover. Find the call in the failed exchanges (on Stripe, Resend, Slack…), then check the emulator state and webhook deliveries: is the failure injected by the matrix, or did the app call the provider wrongly? |
| invariant failed under a matrix fault                                       | The app mishandles that fault (no idempotency, no webhook dedupe, no retry); the trial's label names it                                                                                                                                                       |
| `STALE_RECORDING`, `NOTHING_RECORDED`                                       | Recordings are missing or out of date: run `danwo test` once to record, then the matrix                                                                                                                                                                       |
| `AGENT_LOOPING`, `BUDGET_EXCEEDED`                                          | Split the instruction or replace it with locator steps                                                                                                                                                                                                        |
| class `inconclusive` (`MODEL_OUTPUT_INVALID`, `CLAIM_INCONCLUSIVE`)         | Not an app bug; rephrase the claim or rerun                                                                                                                                                                                                                   |
| class `infra` (`BROWSER_FAILED`, `ENVIRONMENT_FAILED`, `MODEL_UNAVAILABLE`) | The environment hook, the browser or the model provider; fix the setup, not the test                                                                                                                                                                          |
| class `config` (`CONFIG_INVALID`)                                           | The config or the call named in the message                                                                                                                                                                                                                   |

`danwo spec --topic errors` has every code; `danwo guide debugging` walks through a failure page.
