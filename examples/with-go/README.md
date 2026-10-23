# danwo with Go

Quillwork sells one paid plan to teams. A team signs up, presses "Upgrade to Team" and pays on
Stripe Checkout. Stripe's webhook then starts the plan and the app sends a welcome email through
Resend. It is a Go app: the standard library's `net/http` and `html/template`, Postgres through
pgx, and the official Stripe and Resend Go SDKs. There is no Node in it.

danwo runs Stripe and Resend as emulators, gives every worker its own Postgres, and blocks every
other outside call. The tests are TypeScript, as with any app danwo tests.

## What this shows

- **A Go app behind danwo's proxy.** Go doesn't load danwo's Node preload. It follows
  `HTTPS_PROXY` on its own, and trusts danwo's certificate authority through `SSL_CERT_FILE`, on
  Linux and on macOS. The app's code has no test hooks.
- **Invariants that read both sides.** After every test, the app's database is checked against
  Stripe and Resend: one plan per Stripe subscription, each with the status Stripe has, no team
  with two active plans, and one welcome email per team on the plan.
- **A matrix the app survives.** `danwo matrix` plans 36 faults on the upgrade: Stripe 5xx, 429s
  and a declined card, duplicate, late and forged webhooks, Resend failures and lost answers,
  Postgres serialization failures, a refused connection and lost COMMITs, and a double-submitted
  form. The app passes all of them.
- **Bugs you can switch on.** `QUILLWORK_BUG` turns one safeguard off, and the matrix shows which
  trial catches it.

## Run

Use Go 1.24 or newer, Node 24 and Docker. From this folder:

```sh
npm install
npm test
```

```text
Running 6 tests with 2 workers
  - tests/agentic.danwo.ts › the agent starts a team on the Team plan 0 ms, worker 0
  - tests/agentic.danwo.ts › the agent reads what the team pays 0 ms, worker 0
  ✓ tests/deterministic.danwo.ts › asks for a valid email and a team name 1885 ms, worker 1
  ✓ tests/deterministic.danwo.ts › signs up on the Free plan 1626 ms, worker 1
  ✓ tests/deterministic.danwo.ts › upgrades to the Team plan through Stripe Checkout 4364 ms, worker 1
  ✓ tests/deterministic.danwo.ts › a declined card shows Stripe's error and starts no plan 2911 ms, worker 1

4 passed, 2 skipped
```

The first worker to start runs `go build -o dist/quillwork .`, and the others wait for it, so the
app compiles once per run, and only when a Go file, a template or `go.mod` changed. Each worker
then starts its own Postgres container and the binary behind danwo's proxy; the app creates its
tables at start. If Chromium is missing, danwo tells you to run `npx @danwo/cli install-browser`.

| Script                 | What it runs                                                  |
| ---------------------- | ------------------------------------------------------------- |
| `npm test`             | every test; the agent tests skip without a model key          |
| `npm run test:agentic` | the agent tests alone                                         |
| `npm run matrix:plan`  | what the upgrade's fault matrix would try, without running it |
| `npm run matrix`       | the upgrade's fault matrix: 36 trials, about a minute         |
| `npm run serve`        | danwo's dashboard over everything the runs recorded           |
| `npm run build`        | `go build`, as the tests run it                               |
| `npm run typecheck`    | `tsc` over the tests and the config                           |

### Use your own Postgres

Without Docker, point `DATABASE_URL` at a Postgres you run. Its database name must end in `_test`;
each worker creates `quillwork_w0_test`, `quillwork_w1_test` and so on beside it, so the role needs
`CREATEDB`:

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:5432/quillwork_test npm test
```

## How a Go app reaches the emulators

danwo starts the binary with the proxy's environment, the same as for a Node app. Two parts of it
matter to Go:

| Variable        | What Go does with it                                                                 |
| --------------- | ------------------------------------------------------------------------------------ |
| `HTTPS_PROXY`   | `net/http`'s default transport sends every HTTPS call through danwo's proxy          |
| `SSL_CERT_FILE` | names danwo's CA; Go trusts it on Linux, and `trust.go` adds it to the pool on macOS |

On Linux, Go reads `SSL_CERT_FILE` itself. On macOS and Windows it asks the operating system to
verify certificates and ignores the variable, so the app would refuse danwo's certificate there.
`trust.go` is the small, honest fix: when `SSL_CERT_FILE` is set, it adds that file to a copy of
the system's pool, and the Stripe and Resend clients use a transport with that pool. In production
the variable is unset and the client trusts what Go's default one does.

`danwo.config.ts` starts the binary with `SSL_CERT_FILE` pointing at the CA file danwo names for
Node apps:

```ts title="danwo.config.ts · the app's command"
command: `SSL_CERT_FILE="$NODE_EXTRA_CA_CERTS" exec "${BINARY}"`,
```

danwo's start-up check that each app process goes through the proxy is part of its Node preload,
so it says nothing about a Go process. `unmatched: "block"` still answers any other host with a
502, as long as the call reaches the proxy.

## Make it break

`QUILLWORK_BUG` turns one of the app's safeguards off. Run the upgrade's matrix with it and watch
the trial that catches it go red. Everything else still passes.

**`QUILLWORK_BUG=no-webhook-dedupe npm run matrix`** drops the webhook event log and the unique
index that allows one row per Stripe subscription. A repeated `checkout.session.completed` then
records the plan twice:

```text
FAIL  duplicate on stripe webhook checkout.session.completed
        invariant: one plan per Stripe subscription: expected [ Array(2) ] to deeply equal [ 'sub_Bw7cIKnJTJIYK13veIPJewMK' ]
faults: 33 passed, 1 failed
```

**`QUILLWORK_BUG=no-idempotency-key npm run matrix`** sends the welcome email without its
idempotency key. When Resend sends the email but its answer is lost, the app's retry sends a
second one:

```text
FAIL  reset-after on POST api.resend.com/emails
        invariant: one welcome email per team on the plan: expected [ { …(9) }, { …(9) } ] to have a length of 1 but got 2
faults: 35 passed, 1 failed
```

To rerun one trial while you fix it, pass its label to `--faults`:

```sh
QUILLWORK_BUG=no-webhook-dedupe npx @danwo/cli matrix tests/deterministic.danwo.ts \
  --grep "upgrades to the Team plan" --faults "^duplicate on stripe webhook"
```

## How the app stays correct

| Fault                                         | What the app does                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Stripe answers 5xx or drops the line          | the Stripe SDK retries with the request's idempotency key                                     |
| Stripe answers 429                            | the app backs off and tries again with the same key; the SDK leaves rate limits to the caller |
| the upgrade is pressed twice                  | the idempotency key is the account and the price, so both get the same Checkout Session       |
| a webhook arrives twice, late or out of order | each event id is logged in the activation's transaction, and the status is read from Stripe   |
| a forged or stale webhook                     | `webhook.ConstructEvent` refuses it; Stripe's retry is signed fresh and lands                 |
| Postgres fails a statement or loses a COMMIT  | the transaction runs again from the start; a COMMIT that did land is found by its event id    |
| Postgres refuses connections for a while      | every statement is retried with backoff for a few seconds                                     |
| Resend fails, times out or loses its answer   | retried with the same idempotency key, then again in the background; the plan is already safe |

## Agent tests

`tests/agentic.danwo.ts` has two agent tests: "the agent starts a team on the Team plan" and "the
agent reads what the team pays". Each is paired with a check that needs no model: only the agent's
team is on the plan, and the price the agent read is Stripe's.

They skip without a model key. Set a [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key
to run them:

```sh
AI_GATEWAY_API_KEY="your-key" npm run test:agentic
```

The first run records each step; later runs replay it with no model calls.

## Against a local build of danwo

To run this example against danwo's source instead of the published packages, while you work
on danwo, build the packages and install the example from them, from the root of the danwo
repository:

```sh
bun install
bun run release 0.1.2 --pack
node examples/link.ts with-go
```

`link.ts` copies the example to a temporary folder, points danwo's packages at the tarballs in
`dist/release`, runs `npm install` there and prints the folder. Run the commands above from it.

## Where things are

| Path                                                     | What it is                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `main.go`, `server.go`                                   | start-up, the pages, the checkout button and Stripe's webhook              |
| `billing.go`                                             | Stripe Checkout, the activation and the status sync                        |
| `mail.go`                                                | the welcome email through Resend, once per team                            |
| `db.go`, `schema.sql`                                    | the tables, retries for what is safe to repeat, and transactions           |
| `trust.go`                                               | the HTTP client: `HTTPS_PROXY`, and `SSL_CERT_FILE` on every platform      |
| `templates/`, `kit/`                                     | the pages, and the examples' shared styles                                 |
| `danwo.config.ts`                                        | the build, the worker's Postgres, data proxy, snapshots, emulators and app |
| `tests/quillwork.ts`                                     | the steps the tests share, and the invariants                              |
| `tests/deterministic.danwo.ts`, `tests/agentic.danwo.ts` | four locator tests, and two agent tests                                    |

Last checked with @danwo/cli 0.1.2, Go 1.24, stripe-go v87, resend-go v4, pgx 5.8, Postgres 17 and
Node 24.
