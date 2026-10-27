# With Python

Fern Studio is a small studio's booking app: browse the week's classes, book a place, pay with
Stripe Checkout, get a confirmation email through Resend, and see your bookings. It is two apps,
the way most teams build one:

- **`api/`**, a JSON API in Python: FastAPI on Postgres through psycopg 3, with the official
  `stripe` and `resend` SDKs and Stripe's webhook.
- **`web/`**, the site, in SvelteKit: its pages load from the API on the server, its Book button
  is a form action that calls the API, and two pages also call the API from the browser.

None of the providers is real here. danwo runs Stripe and Resend as emulators, gives every test
a fresh database, and refuses every other outside call. The tests are TypeScript, like every
danwo project's.

## What this shows

- **Two apps in two languages, behind one proxy.** `stackEnvironment` starts the API, then the
  site once the API is ready, and hands each the other's address. The site's server runs in Node,
  so it gets danwo's preload. The API can't, so danwo sets the standard proxy and CA variables
  for it instead.
- **Every hop on the record.** The browser's requests, the site's server calling the API, the
  browser calling the API, and the API calling Stripe and Resend all go through danwo's proxy.
  Readiness waits for all of them, and the flight record shows which client made each call.
- **Invariants that read both sides.** After every test, the API's database is checked against
  Stripe and Resend: one booking per paid Checkout Session, a place taken once per booking, one
  confirmation email per booking, and amounts equal to what Stripe charged.
- **A matrix the app survives.** `danwo matrix` plans 54 faults on a booking: Stripe 5xx, 429s
  and a declined card, duplicate, late, forged and stale webhooks, a double-submitted booking,
  Resend failures, Postgres serialization failures, deadlocks and lost COMMITs, and the
  confirmation page's poll of the API failing. The app
  passes all of them, with retries, idempotency keys and webhook dedupe.
- **A bug you can switch on.** `STUDIO_BUG` turns one safeguard off, and the matrix shows which
  trials go red.

The app's code has no test hooks.

## Run

Use Node 24, [uv](https://docs.astral.sh/uv/getting-started/installation/) and Docker. From this
folder:

```sh
npm install
npm test
```

```text
Running 6 tests with 2 workers
danwo: api runs no Node process (uv, python), so danwo's check at start that its calls reach the proxy, which runs inside Node, does not run for it, and nothing confirms its calls go through the proxy: …
  - tests/agentic.danwo.ts › books the cheapest class 0 ms, worker 0
  - tests/agentic.danwo.ts › finds my booking 0 ms, worker 0
  ✓ tests/deterministic.danwo.ts › browses the timetable 1748 ms, worker 1
  ✓ tests/deterministic.danwo.ts › books a class and pays through Stripe Checkout 3113 ms, worker 1
  ✓ tests/deterministic.danwo.ts › a declined card shows Stripe's error and books nothing 2203 ms, worker 1
  ✓ tests/deterministic.danwo.ts › lists my bookings 3541 ms, worker 1

4 passed, 2 skipped
```

Before the apps start, the first worker builds the site with `vite build` while the others wait
for it. Each worker runs `uv sync --frozen` for the API; the first run installs Python 3.12 and
the packages in `uv.lock`.

Each worker then starts its own Postgres container, creates the tables with the API's own
`python -m studio.schema`, seeds the timetable, and starts both apps. It removes the container
when it ends. If Chromium is missing, danwo tells you to run `npx @danwo/cli install-browser`.

The line about the check at start is expected. For a Node app, danwo checks inside the process
that its calls reach the proxy. That check runs for the site, but can't run in Python, so danwo
says so for the API instead.

The scripts:

| Script                | What it runs                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `npm test`            | every test; the agent tests skip without a model key               |
| `npm run matrix:plan` | what the booking's fault matrix would try, without running it      |
| `npm run matrix`      | the booking's fault matrix: 54 trials, a little over a minute      |
| `npm run serve`       | danwo's dashboard over everything the runs recorded                |
| `npm run typecheck`   | `svelte-check` over the site, then `tsc` over the tests and config |
| `npm run build`       | the site's build alone; the tests build it when it is stale        |

### Use your own Postgres

Without Docker, point `DATABASE_URL` at a Postgres you run. Its database name must end in `_test`.
Each worker creates `studio_w0_test`, `studio_w1_test` and so on beside it, so the role needs
`CREATEDB`:

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:5432/studio_test npm test
```

## How the two apps are wired

`danwo.config.ts` starts them with `stackEnvironment`. Each app's `env` is a function that gets
every app's address by name:

```ts
apps: [
  {
    name: "api",
    command: `uv run --no-sync uvicorn studio.app:app --host 127.0.0.1 --port ${apiPort}`,
    cwd: API_DIR,
    url: local(apiPort),
    ready: { path: "/health" },
    env: ({ web = "" }) => ({ WEB_URL: web, DATABASE_URL: postgres.url(database) /* … */ }),
  },
  {
    name: "web",
    command: "node server.ts",
    cwd: WEB_DIR,
    url: local(webPort),
    ready: { path: "/health" },
    dependsOn: ["api"],
    env: ({ api = "" }) => ({ HOST: "127.0.0.1", API_URL: api, PUBLIC_API_URL: api }),
  },
],
```

The site's server calls the API at `API_URL`, and the browser at `PUBLIC_API_URL`. The API uses
`WEB_URL` to send customers back from Stripe, and to let the site's pages read its answers in the
browser. Stripe's webhook goes straight to the API.

`web/server.ts` is adapter-node's handler behind Node's own HTTP server. `node build` alone takes
every request to be HTTPS unless a proxy in front says otherwise, so a form posted from an
`http://` page fails SvelteKit's cross-site check. The server serves HTTP itself, so it says so.

### What goes through the proxy

| Call                                   | Made by                    | In the flight record       |
| -------------------------------------- | -------------------------- | -------------------------- |
| the pages and the Book form            | the browser                | `browser`, to the site     |
| page loads and the Book action         | the site's server, in Node | `server`, to the API       |
| My bookings' Refresh, the confirmation | the browser                | `browser`, to the API      |
| Stripe and Resend                      | the API, in Python         | `server`, to the emulators |

The site's server reaches the proxy because danwo's preload routes Node's `fetch`. The calls
between the apps are on this machine, so the proxy passes them on and records them. The matrix
faults the browser's calls to the API as it does a provider call: the confirmation page's poll
gets a 500 and a dropped connection, and the page asks again a second later. The site server's
calls to the API are left alone.

## How the API reaches the emulators

danwo starts the API with these in its environment, whatever language it is in:

| Variable                                | What reads it                                      |
| --------------------------------------- | -------------------------------------------------- |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | requests, httpx and urllib, in upper or lower case |
| `REQUESTS_CA_BUNDLE`                    | requests, so the Resend SDK                        |
| `SSL_CERT_FILE`                         | httpx, urllib and Python's `ssl`                   |
| `CURL_CA_BUNDLE`                        | curl, and requests when the one above is unset     |

One SDK needs a line of its own. The Stripe SDK verifies against the CA bundle it ships and reads
no variable, so `api/studio/payments.py` points it at the bundle the environment names, as an app
behind a company's TLS proxy would:

```python
ca_bundle = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
if ca_bundle:
    stripe.ca_bundle_path = ca_bundle
```

The API starts with `uv run --no-sync`, so starting it never downloads a package. The start
command runs behind the proxy too, and `unmatched: "block"` would refuse PyPI.

## Make it break

`STUDIO_BUG` turns one of the API's safeguards off. Run the booking's matrix with it and watch
the trials that catch it go red. Everything else still passes.

**`STUDIO_BUG=no-webhook-dedupe npm run matrix`** drops the webhook event log and the unique index
that allows one booking per Checkout Session. Two trials fail, each with a second booking for one
payment:

```text
FAIL  duplicate on stripe webhook checkout.session.completed
        invariant: one booking per paid Checkout Session: expected [ …(2) ] to deeply equal [ Array(1) ]
FAIL  reset-after on COMMIT (postgres)
        invariant: one booking per paid Checkout Session: expected [ …(2) ] to deeply equal [ Array(1) ]
faults: 47 passed, 2 failed
```

The second is the subtle one: the COMMIT landed but its answer was lost, so the API retried a
transaction that had already succeeded. The plan has 49 trials here, not 54: with no event log,
there is no insert into it to fault.

**`STUDIO_BUG=no-idempotency-key npm run matrix`** creates the Checkout Session without an
idempotency key. One trial fails: pressing Book twice runs the site's form action twice, the API
starts two sessions for one place, and the customer could pay both.

```text
FAIL  double-submit on POST /classes/sunrise-flow
        POST /classes/sunrise-flow sent twice at once: 303 and 303
        invariant: one Checkout Session per class and customer: expected [ …(2) ] to deeply equal [ Array(1) ]
faults: 53 passed, 1 failed
```

To rerun one trial while you fix it, pass its label to `--faults`:

```sh
STUDIO_BUG=no-webhook-dedupe npx @danwo/cli matrix tests/deterministic.danwo.ts \
  --grep "books a class" --faults "^duplicate on stripe webhook"
```

## How the app stays correct

| Fault                                        | What the app does                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Stripe answers 5xx, 429 or drops the line    | the Stripe SDK retries with the request's idempotency key; the API backs off on 429                   |
| Book is pressed twice                        | the idempotency key is the class and what Stripe is asked for, so both get the same Checkout Session  |
| a webhook arrives twice or late              | each event id is logged in the same transaction as the booking, and a booking is unique per session   |
| the customer lands before the webhook        | the confirmation page says so and asks the API again from the browser until the booking is there      |
| a forged or stale webhook                    | the SDK's signature check refuses it; Stripe's retry is signed fresh and lands                        |
| Postgres fails a statement or loses a COMMIT | booking is one transaction, retried from the start; a COMMIT that did land is recognised by its event |
| Resend fails or times out                    | retried with the same idempotency key, then again in the background; the booking is already safe      |

## Agent tests

`tests/agentic.danwo.ts` has two agent tests: "books the cheapest class" and "finds my booking".
Each is paired with a check that needs no model: the one booking is for Breathwork, the cheapest
class, and the booking number the agent read is the customer's latest in the database.

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
bun run release 0.1.6 --pack
node examples/link.ts with-python
```

`link.ts` copies the example to a temporary folder (leaving out `.venv` and the site's build),
points danwo's packages at the tarballs in `dist/release`, installs them there and prints the
folder. Run the commands above from it.

## Where things are

| Path                            | What it is                                                                  |
| ------------------------------- | --------------------------------------------------------------------------- |
| `api/studio/app.py`             | the JSON API: classes, checkout, a session's booking, bookings, the webhook |
| `api/studio/payments.py`        | the Stripe client and starting a Checkout Session                           |
| `api/studio/bookings.py`        | turning a paid session into a booking, in one transaction                   |
| `api/studio/confirmations.py`   | confirmation emails through Resend                                          |
| `api/studio/db.py`              | the psycopg pool and the transaction retries                                |
| `api/studio/schema.py`          | the tables, created by `python -m studio.schema`                            |
| `api/pyproject.toml`, `uv.lock` | the API's Python packages, pinned                                           |
| `web/src/routes/`               | the site's pages, their server loads and the Book action                    |
| `web/src/lib/server/api.ts`     | the site's server calling the API                                           |
| `web/src/lib/browser-api.ts`    | the browser calling the API                                                 |
| `web/src/env.ts`                | the site's environment: where the API answers                               |
| `web/server.ts`                 | serving the built site over HTTP                                            |
| `seed/classes.json`             | the week's classes, seeded into Postgres and, as prices, into Stripe        |
| `danwo.config.ts`               | the two apps, the emulators, the database proxy and the snapshots           |
| `kit/`                          | the examples' shared styles                                                 |
| `tests/`                        | the tests, the invariants (`studio.ts`) and the build and database helpers  |

Last checked with @danwo/cli 0.1.6, Python 3.12, FastAPI 0.162, psycopg 3.3, stripe 16.0,
resend 2.50, SvelteKit 3.1, Svelte 5.57, Postgres 17 and Node 24.
