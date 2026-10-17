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

## Packages

| Package            | What it is                                                           |
| ------------------ | -------------------------------------------------------------------- |
| `@danwo/sdk`       | The public test API                                                  |
| `@danwo/cli`       | `danwo test`, `danwo matrix`, `danwo show`                           |
| `@danwo/runner`    | Browser sessions, the agent, replay, workers and the flight recorder |
| `@danwo/core`      | The fault matrix                                                     |
| `@danwo/proxy`     | The egress proxy                                                     |
| `@danwo/emulators` | Provider emulators                                                   |

See `examples/shop` for a small app tested with `danwo test` and `danwo matrix`.

## Development

Node 24 and bun.

```bash
bun install
bun run check       # format, lint, fallow, typecheck, unit tests
bun run test:slow   # browser and CLI tests
```

## Status

Early. APIs will change.
