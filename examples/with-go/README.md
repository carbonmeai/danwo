# danwo with Go

Quillwork sells one paid plan to teams. A team signs up, presses "Upgrade to Team" and pays on
Stripe Checkout. Stripe's webhook then starts the plan and the app sends a welcome email through
Resend. It is built the way many Go products are: a Go server with a JSON API on `net/http`,
Postgres through pgx, the official Stripe and Resend Go SDKs, and a Vue 3 single-page app (Vite,
TypeScript, Vue Router) that calls the API from the browser.

danwo runs Stripe and Resend as emulators, gives every worker its own Postgres, and blocks every
other outside call. The tests are TypeScript, as with any app danwo tests.

## What this shows

- **A Go server behind danwo's proxy.** Go doesn't load danwo's Node preload. It follows
  `HTTPS_PROXY` on its own, and trusts danwo's certificate authority through `SSL_CERT_FILE`, on
  Linux and on macOS. The app's code has no test hooks.
- **A single-page app's calls, faulted.** The browser's calls to the API go through danwo's proxy
  too. The flight record shows each one, and the matrix fails them: a 500, a dropped connection,
  an answer lost after the API acted, and the upgrade sent twice at once. The config turns these
  faults on with `matrix: { pageCalls: true }`; they are off by default.
- **Invariants that read both sides.** After every test, the app's database is checked against
  Stripe and Resend: one plan per Stripe subscription, each with the status Stripe has, no team
  with two active plans, one welcome email per team on the plan, and one Checkout Session per team.
- **A matrix the app survives.** `danwo matrix` plans 44 faults on the upgrade: the page's calls
  to the API, Stripe 5xx, 429s and a declined card, duplicate, late and forged webhooks, Resend
  failures and lost answers, Postgres serialization failures, a refused connection and lost
  COMMITs, and double submits. The app passes all of them.
- **Bugs you can switch on.** `QUILLWORK_BUG` turns one safeguard off, and the matrix shows which
  trial catches it.

## Run

Use Go 1.26 or newer, Node 24 and Docker. From this folder:

```sh
npm install
npm test
```

```text
Running 6 tests with 2 workers
  - tests/agentic.danwo.ts › the agent starts a team on the Team plan 0 ms, worker 0
  - tests/agentic.danwo.ts › the agent reads what the team pays 0 ms, worker 0
  ✓ tests/deterministic.danwo.ts › asks for a valid email and a team name 1765 ms, worker 1
  ✓ tests/deterministic.danwo.ts › signs up on the Free plan 1551 ms, worker 1
  ✓ tests/deterministic.danwo.ts › upgrades to the Team plan through Stripe Checkout 6480 ms, worker 1
  ✓ tests/deterministic.danwo.ts › a declined card shows Stripe's error and starts no plan 3011 ms, worker 1

4 passed, 2 skipped
```

The first worker to start builds the web app with `vite build web` and the server with `go build`,
and the others wait for it. So each build runs once per run, and only when its sources changed.
Each worker then starts its own Postgres container and the server behind danwo's proxy; the server
creates its tables at start. If Chromium is missing, danwo tells you to run
`npx @danwo/cli install-browser`.

| Script                 | What it runs                                                     |
| ---------------------- | ---------------------------------------------------------------- |
| `npm test`             | every test; the agent tests skip without a model key             |
| `npm run test:agentic` | the agent tests alone                                            |
| `npm run matrix:plan`  | what the upgrade's fault matrix would try, without running it    |
| `npm run matrix`       | the upgrade's fault matrix: 44 trials, about a minute and a half |
| `npm run serve`        | danwo's dashboard over everything the runs recorded              |
| `npm run build`        | `vite build web`, then `go build`, as the tests run them         |
| `npm run typecheck`    | `vue-tsc` over the web app, then `tsc` over the tests            |

### Use your own Postgres

Without Docker, point `DATABASE_URL` at a Postgres you run. Its database name must end in `_test`;
each worker creates `quillwork_w0_test`, `quillwork_w1_test` and so on beside it, so the role needs
`CREATEDB`:

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:5432/quillwork_test npm test
```

## One origin: Go serves the page and the API

The Go server answers the API, Stripe's webhook and the built Vue app's files, all on one origin.
A path the router owns, such as `/account` or `/checkout/return`, gets `index.html`, so a
bookmark, a refresh or Stripe's redirect back lands on the right page.

That is the usual shape for a Go product, and it keeps the session simple. The session is an
HTTP-only, `SameSite=Lax` cookie the browser sends with every call to the API, and there is no CORS
to configure. The API only takes JSON writes, which a form on another site can't send. In
development, `vite web` serves the page with hot reload and passes `/api` on to the Go server.

So `danwo.config.ts` starts one app, the binary, with `WEB_DIR` naming Vite's output:

```ts title="danwo.config.ts · the app"
command: `exec "${BINARY}"`,
cwd: ROOT,
url,
ready: { path: "/health" },
env: { HOST: "127.0.0.1", APP_URL: url, WEB_DIR: WEB_DIST /* … */ },
```

## How a Go app reaches the emulators

danwo starts the binary with the proxy's environment, the same as for a Node app. Two parts of it
matter to Go:

| Variable        | What Go does with it                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `HTTPS_PROXY`   | `net/http`'s default transport sends every HTTPS call through danwo's proxy                     |
| `SSL_CERT_FILE` | names danwo's CA bundle; Go trusts it on Linux, and `api/trust.go` adds it to the pool on macOS |

On Linux, Go reads `SSL_CERT_FILE` itself. On macOS and Windows it asks the operating system to
verify certificates and ignores the variable, so the app would refuse danwo's certificate there.
`api/trust.go` is the small, honest fix: when `SSL_CERT_FILE` is set, it adds that file to a copy
of the system's pool, and the Stripe and Resend clients use a transport with that pool. In
production the variable is unset and the client trusts what Go's default one does.

danwo's start-up check that each app process goes through the proxy is part of its Node preload,
so it can't run in a Go process; danwo says so once when the app starts. `unmatched: "block"`
still answers any other host with a 502, as long as the call reaches the proxy.
[Apps in other languages](https://danwo.dev/docs/other-languages) covers what else differs.

## What danwo sees of the page

danwo's browser sends everything through the proxy, so the flight record holds the page's calls
beside the server's. In the record, each page call to the API is a passthrough exchange from the
browser with a load of `request`, and a faulted one names its fault. The upgrade's record, in
order:

| Who     | Call                                                    | Recorded as                    |
| ------- | ------------------------------------------------------- | ------------------------------ |
| browser | `GET /`, then the hashed script and stylesheet          | page loads, left out of faults |
| browser | `GET /api/session`, `POST /api/signup`                  | the page's calls to the API    |
| browser | `POST /api/billing/checkout`                            | the page's call to the API     |
| server  | `POST api.stripe.com/v1/checkout/sessions`              | routed to the Stripe emulator  |
| browser | Stripe's Checkout page, and paying on it                | routed to the Stripe emulator  |
| browser | `/checkout/return`, then `GET /api/session` each second | the page polling for the plan  |
| server  | `GET api.stripe.com/v1/subscriptions/…`, Resend         | the webhook's work             |

The matrix plans faults on the page's calls as it does on the server's. Each gets `status 500` and
`reset`, and each write also gets `reset-after`: the API acted, but the page never heard. The page
sends a failed call again, a few times, because every write the API takes is safe to repeat. A
sign-up lands on the same account, and a checkout gets the same Checkout Session back through its
idempotency key.

## Make it break

`QUILLWORK_BUG` turns one of the app's safeguards off. Run the upgrade's matrix with it and watch
the trial that catches it go red. Everything else still passes.

**`QUILLWORK_BUG=no-checkout-key npm run matrix`** starts the checkout without the app's own
idempotency key. The Stripe SDK still sets one for its own retries, so Stripe's lost answers pass.
But when the page sends the upgrade again, after a lost answer or twice at once, the team gets a
second Checkout Session it could pay for:

```text
FAIL  reset-after on POST 127.0.0.1/api/billing/checkout
        invariant: one Checkout Session per team: expected [ '1', '1' ] to deeply equal [ '1' ]
FAIL  double-submit on POST /api/billing/checkout
        POST /api/billing/checkout sent twice at once: 200 and 200
        invariant: one Checkout Session per team: expected [ '1', '1' ] to deeply equal [ '1' ]
faults: 42 passed, 2 failed
```

**`QUILLWORK_BUG=no-webhook-dedupe npm run matrix`** drops the webhook event log and the unique
index that allows one row per Stripe subscription. A repeated `checkout.session.completed` then
records the plan twice:

```text
FAIL  duplicate on stripe webhook checkout.session.completed
        invariant: one plan per Stripe subscription: expected [ Array(2) ] to deeply equal [ 'sub_bgtWive7EpxHVeGjadi7KRDM' ]
faults: 41 passed, 1 failed
```

**`QUILLWORK_BUG=no-idempotency-key npm run matrix`** sends the welcome email without its
idempotency key. When Resend sends the email but its answer is lost, the app's retry sends a
second one:

```text
FAIL  reset-after on POST api.resend.com/emails
        invariant: one welcome email per team on the plan: expected [ { …(9) }, { …(9) } ] to have a length of 1 but got 2
faults: 43 passed, 1 failed
```

To rerun one trial while you fix it, pass its label to `--faults`:

```sh
QUILLWORK_BUG=no-checkout-key npx @danwo/cli matrix tests/deterministic.danwo.ts \
  --grep "upgrades to the Team plan" --faults "^double-submit on POST /api/billing"
```

## How the app stays correct

| Fault                                           | What the app does                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| the API answers the page 500, or drops the line | the page sends the call again, a few times, before it shows an error                          |
| the API acted, but the page never heard         | the retry is safe: a sign-up upserts by email, a checkout reuses its idempotency key          |
| the upgrade is pressed twice                    | the idempotency key is the account and the price, so both get the same Checkout Session       |
| Stripe answers 5xx or drops the line            | the Stripe SDK retries with the request's idempotency key                                     |
| Stripe answers 429                              | the app backs off and tries again with the same key; the SDK leaves rate limits to the caller |
| a webhook arrives twice, late or out of order   | each event id is logged in the activation's transaction, and the status is read from Stripe   |
| a forged or stale webhook                       | `webhook.ConstructEvent` refuses it; Stripe's retry is signed fresh and lands                 |
| the webhook lands after the browser is back     | the return page asks the API every second until the plan is active                            |
| Postgres fails a statement or loses a COMMIT    | the transaction runs again from the start; a COMMIT that did land is found by its event id    |
| Postgres refuses connections for a while        | every statement is retried with backoff for a few seconds                                     |
| Resend fails, times out or loses its answer     | retried with the same idempotency key, then again in the background; the plan is already safe |

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
bun run release 0.1.5 --pack
node examples/link.ts with-go
```

`link.ts` copies the example to a temporary folder, points danwo's packages at the tarballs in
`dist/release`, runs `npm install` there and prints the folder. Run the commands above from it.

## Where things are

| Path                                                     | What it is                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `api/main.go`, `api/server.go`                           | start-up, the JSON API and Stripe's webhook                                 |
| `api/web.go`                                             | the built web app's files, and `index.html` for the router's paths          |
| `api/billing.go`                                         | Stripe Checkout, the activation and the status sync                         |
| `api/mail.go`                                            | the welcome email through Resend, once per team                             |
| `api/db.go`, `api/schema.sql`                            | the tables, retries for what is safe to repeat, and transactions            |
| `api/trust.go`                                           | the HTTP client: `HTTPS_PROXY`, and `SSL_CERT_FILE` on every platform       |
| `web/src/api.ts`                                         | the page's calls to the API, and when it sends one again                    |
| `web/src/pages/`, `web/src/components/`                  | the plans and sign-up, the account, and the return from Checkout            |
| `kit/`                                                   | the examples' shared styles                                                 |
| `danwo.config.ts`                                        | the builds, the worker's Postgres, data proxy, snapshots, emulators and app |
| `tests/quillwork.ts`                                     | the steps the tests share, and the invariants                               |
| `tests/deterministic.danwo.ts`, `tests/agentic.danwo.ts` | four locator tests, and two agent tests                                     |

Last checked with @danwo/cli 0.1.5, Go 1.26, stripe-go v87, resend-go v4, pgx 5.11, Postgres 17,
Vue 3.5, Vue Router 5, Vite 8 and Node 24.
