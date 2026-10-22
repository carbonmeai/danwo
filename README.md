<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/readme-hero/hero-dark.png">
  <img src="brand/readme-hero/hero-light.png" alt="dánwò: Drive the UI. Judge everything behind it." width="100%">
</picture>

<br>

<h3 align="center">dánwò</h3>

<p align="center">
  The open-source testing framework that drives your app through its UI like a user,<br>
  and then checks everything that happened behind it.
  <br>
  <a href="https://danwo.dev"><strong>Learn more »</strong></a>
</p>

<p align="center">
  <a href="https://danwo.dev/docs/quickstart">Quickstart</a> ·
  <a href="https://danwo.dev/docs">Docs</a> ·
  <a href="https://danwo.dev/docs/fault-matrix">Fault matrix</a> ·
  <a href="https://danwo.dev/docs/coding-agents">Coding agents</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-Apache--2.0-blue" alt="Licence: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/node-22.22.3%2B%20%7C%2024.11.1%2B-339933?logo=nodedotjs&logoColor=white" alt="Node 22.22.3+ or 24.11.1+">
  <img src="https://img.shields.io/badge/npm-%40danwo%2Fcli%20%C2%B7%20beta%20soon-cb3837?logo=npm&logoColor=white" alt="npm @danwo/cli: beta soon">
  <img src="https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white" alt="TypeScript">
</p>

<br>

A test that clicks "Pay" and sees "Thank you" proves little. Was the card charged once? Did the
webhook arrive? Was one email sent? danwo checks all of it, then breaks the run on purpose to see
what your app does when a provider fails.

|                            |                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Drives your app**        | In a browser, on Android or on iOS, with locators, plain-English agent steps, or both. Agent steps replay later with no model calls.  |
| **Emulates the providers** | Stripe, Clerk, Resend, Google, Slack and 20 more answer from local emulators behind a proxy. No sandbox keys, no code changes.        |
| **Breaks it on purpose**   | `danwo matrix` reruns a test once per fault: 500s, declines, duplicate webhooks, lost database commits. An invariant judges each run. |
| **Explains every run**     | A flight record with video, steps, calls, webhooks and database statements, in a dashboard, a PR comment and over MCP.                |

## Quickstart

You need Node.js 22.22.3 or a later 22, or 24.11.1 or newer. In your app's folder:

```sh
npx @danwo/cli init
npx @danwo/cli install-browser
npm run test:danwo
```

`init` asks what to test, which providers to emulate and which coding agents to set up, then
writes a config and a first test that passes. See the [quickstart](https://danwo.dev/docs/quickstart).

## A test

```ts
const EMAIL = "ada@lumen.example"

test("joins the waitlist", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByLabel("Work email").fill(EMAIL)
  await screen.getByRole("button", { name: "Join the waitlist" }).click()

  await expect(screen.getByRole("status")).toContainText("You're on the list")
}).invariant(async ({ databaseUrl, resend, expect }) => {
  // Whatever went wrong on the way: one row, one welcome email.
  expect(await sql(databaseUrl, "select id from signups where email = $1", [EMAIL])).toHaveLength(1)
  expect(resendInbox(resend).list(EMAIL)).toHaveLength(1)
})
```

## Break it on purpose

```sh
npx @danwo/cli matrix tests/waitlist.danwo.ts
```

```text
PASS  status 429 on POST api.resend.com/emails
PASS  reset-after on POST api.resend.com/emails
PASS  serialization_failure on INSERT signups (postgres)
PASS  double-submit on POST /api/join
…
faults: 16 passed
```

Remove the app's idempotency key and two trials turn red: a second welcome email went out.
See [the fault matrix](https://danwo.dev/docs/fault-matrix).

## Examples

Each one runs with no real keys. Clone, install, test.

| Example                               | What it shows                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| [`commerce`](examples/commerce)       | A shop on Next.js, Hono, Postgres and Stripe Checkout. 86 faults held.       |
| [`saas`](examples/saas)               | Workspaces, a trial and billing, Slack and Google, Inngest jobs, live notes. |
| [`clerk-login`](examples/clerk-login) | The real Clerk components, Google sign-in and org invites, on the emulator.  |
| [`better-auth`](examples/better-auth) | Self-hosted Better Auth: email codes, Google and GitHub, linked accounts.    |
| [`with-next`](examples/with-next)     | The smallest one: a Next.js waitlist on Postgres and Resend.                 |

More in the [examples gallery](https://danwo.dev/docs/examples).

## Where it runs

|                                                       |                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| [Web apps](https://danwo.dev/docs/web)                | Any framework, started by danwo or already running.                        |
| [Android](https://danwo.dev/docs/android-tests)       | React Native and Expo on an emulator.                                      |
| [iOS](https://danwo.dev/docs/ios-tests)               | React Native and Expo on an iOS Simulator.                                 |
| [Playwright Test](https://danwo.dev/docs/playwright)  | Keep your tests, add emulators and the matrix.                             |
| [Real stacks](https://danwo.dev/docs/real-stacks)     | Several apps, workers, databases and background jobs behind one proxy.     |
| [CI](https://danwo.dev/docs/ci)                       | A GitHub Check and a PR comment that say what broke and whose fault it is. |
| [Coding agents](https://danwo.dev/docs/coding-agents) | A skill and an MCP server for Claude Code, Cursor and Codex.               |

## Contributing

Node 22.22.3+ or 24.11.1+, and bun:

```sh
bun install
bun run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md), and
[SECURITY.md](SECURITY.md) for reporting a vulnerability. danwo is early: APIs will change.

## The name

_Dánwò_ is Yorùbá for "to test". It comes from _dán … wò_, "try it and see": you put something
to the test and watch what happens. Say it _DAHN-woh_, high then low.

## Licence

The code is under the [Apache License 2.0](LICENSE). The dánwò name and logo are trademarks of
Carbonme Inc; see [TRADEMARKS.md](TRADEMARKS.md).
