# With Python

Fern Studio is a small studio's booking app: browse the week's classes, book a place, pay with
Stripe Checkout, get a confirmation email through Resend, and see your bookings. Its backend is
Python: FastAPI on Postgres through psycopg 3, the official `stripe` and `resend` SDKs, and pages
rendered on the server with Jinja2 and the examples' shared styles. There is no Node in the app.

None of those providers is real here. danwo runs Stripe and Resend as emulators, gives every test
a fresh database, and refuses every other outside call. The tests are TypeScript, like every
danwo project's; the app they drive is not.

## What this shows

- **An app outside Node behind danwo's proxy.** danwo can't load its Node preload into Python, so
  it sets the standard variables instead: `HTTPS_PROXY` and the rest for the proxy, and a CA
  bundle in `SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE`. The Stripe and Resend SDKs reach the
  emulators through them, and the app's code has no test hooks.
- **Invariants that read both sides.** After every test, the app's database is checked against
  Stripe and Resend: one booking per paid Checkout Session, a place taken once per booking, one
  confirmation email per booking, and amounts equal to what Stripe charged.
- **A matrix the app survives.** `danwo matrix` plans 52 faults on a booking: Stripe 5xx, 429s
  and a declined card, duplicate, late, forged and stale webhooks, a double-submitted booking,
  Resend failures, and Postgres serialization failures, deadlocks and lost COMMITs. The app
  passes all of them, with retries, idempotency keys and webhook dedupe.
- **A bug you can switch on.** `STUDIO_BUG` turns one safeguard off, and the matrix shows which
  trials go red.

## Run

Use Node 24, [uv](https://docs.astral.sh/uv/getting-started/installation/) and Docker. From this
folder:

```sh
npm install
npm test
```

```text
Running 6 tests with 2 workers
danwo: studio runs no Node process (uv, python), so danwo's check at start that its calls reach the proxy, which runs inside Node, does not run for it. …
  - tests/agentic.danwo.ts › books the cheapest class 0 ms, worker 0
  - tests/agentic.danwo.ts › finds my booking 0 ms, worker 0
  ✓ tests/deterministic.danwo.ts › browses the timetable 1250 ms, worker 1
  ✓ tests/deterministic.danwo.ts › books a class and pays through Stripe Checkout 2857 ms, worker 1
  ✓ tests/deterministic.danwo.ts › a declined card shows Stripe's error and books nothing 1980 ms, worker 1
  ✓ tests/deterministic.danwo.ts › lists my bookings 2561 ms, worker 1

4 passed, 2 skipped
```

Each worker runs `uv sync --frozen` (the first run installs Python 3.12 and the packages in
`uv.lock` into `.venv`), starts its own Postgres container, creates the tables with the app's own
`python -m studio.schema`, seeds the timetable, and starts the app with
`uv run --no-sync uvicorn` behind danwo's proxy. It removes the container when it ends. If
Chromium is missing, danwo tells you to run `npx @danwo/cli install-browser`.

The line about the check at start is expected. For a Node app, danwo checks inside the process
that its calls reach the proxy; that check can't run in Python, so danwo says so instead.

The scripts:

| Script                | What it runs                                               |
| --------------------- | ---------------------------------------------------------- |
| `npm test`            | every test; the agent tests skip without a model key       |
| `npm run matrix:plan` | what the booking's fault matrix would try, without running |
| `npm run matrix`      | the booking's fault matrix: 52 trials, about a minute      |
| `npm run serve`       | danwo's dashboard over everything the runs recorded        |
| `npm run typecheck`   | `tsc` over the tests and the config                        |

### Use your own Postgres

Without Docker, point `DATABASE_URL` at a Postgres you run. Its database name must end in `_test`;
each worker creates `studio_w0_test`, `studio_w1_test` and so on beside it, so the role needs
`CREATEDB`:

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:5432/studio_test npm test
```

## How a Python app reaches the emulators

danwo starts the app with these in its environment, whatever language it is in:

| Variable                                | What reads it                                      |
| --------------------------------------- | -------------------------------------------------- |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | requests, httpx and urllib, in upper or lower case |
| `REQUESTS_CA_BUNDLE`                    | requests, so the Resend SDK                        |
| `SSL_CERT_FILE`                         | httpx, urllib and Python's `ssl`                   |
| `CURL_CA_BUNDLE`                        | curl, and requests when the one above is unset     |

One SDK needs a line of its own. The Stripe SDK verifies against the CA bundle it ships and reads
no variable, so `studio/payments.py` points it at the bundle the environment names, as an app
behind a company's TLS proxy would:

```python
ca_bundle = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
if ca_bundle:
    stripe.ca_bundle_path = ca_bundle
```

The app starts with `uv run --no-sync`, so starting it never downloads a package: the start
command runs behind the proxy too, and `unmatched: "block"` would refuse PyPI.

## Make it break

`STUDIO_BUG` turns one of the app's safeguards off. Run the booking's matrix with it and watch the
trials that catch it go red. Everything else still passes.

**`STUDIO_BUG=no-webhook-dedupe npm run matrix`** drops the webhook event log and the unique index
that allows one booking per Checkout Session. Two trials fail, each with a second booking for one
payment:

```text
FAIL  duplicate on stripe webhook checkout.session.completed
        invariant: one booking per paid Checkout Session: expected [ …(2) ] to deeply equal [ Array(1) ]
FAIL  reset-after on COMMIT (postgres)
        invariant: one booking per paid Checkout Session: expected [ …(2) ] to deeply equal [ Array(1) ]
```

The second is the subtle one: the COMMIT landed but its answer was lost, so the app retried a
transaction that had already succeeded.

**`STUDIO_BUG=no-idempotency-key npm run matrix`** creates the Checkout Session without an
idempotency key. One trial fails: pressing Book twice starts two sessions for one place, and the
customer could pay both.

```text
FAIL  double-submit on POST /classes/sunrise-flow/book
        POST /classes/sunrise-flow/book sent twice at once: 303 and 303
        invariant: one Checkout Session per class and customer: expected [ …(2) ] to deeply equal [ Array(1) ]
```

To rerun one trial while you fix it, pass its label to `--faults`:

```sh
STUDIO_BUG=no-webhook-dedupe npx @danwo/cli matrix tests/deterministic.danwo.ts \
  --grep "books a class" --faults "^duplicate on stripe webhook"
```

## How the app stays correct

| Fault                                        | What the app does                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Stripe answers 5xx, 429 or drops the line    | the Stripe SDK retries with the request's idempotency key; the app backs off on 429                   |
| Book is pressed twice                        | the idempotency key is the class and what Stripe is asked for, so both get the same Checkout Session  |
| a webhook arrives twice or late              | each event id is logged in the same transaction as the booking, and a booking is unique per session   |
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
bun run release 0.1.2 --pack
node examples/link.ts with-python
```

`link.ts` copies the example to a temporary folder (leaving out `.venv`), points danwo's packages
at the tarballs in `dist/release`, runs `npm install` there and prints the folder. Run the
commands above from it.

## Where things are

| Path                        | What it is                                                                    |
| --------------------------- | ----------------------------------------------------------------------------- |
| `studio/app.py`             | the FastAPI app: the timetable, booking, the confirmation, the Stripe webhook |
| `studio/payments.py`        | the Stripe client and starting a Checkout Session                             |
| `studio/bookings.py`        | turning a paid session into a booking, in one transaction                     |
| `studio/confirmations.py`   | confirmation emails through Resend                                            |
| `studio/db.py`              | the psycopg pool and the transaction retries                                  |
| `studio/schema.py`          | the tables, created by `python -m studio.schema`                              |
| `studio/templates/`         | the Jinja2 pages                                                              |
| `pyproject.toml`, `uv.lock` | the app's Python packages, pinned                                             |
| `seed/classes.json`         | the week's classes, seeded into Postgres and, as prices, into Stripe          |
| `danwo.config.ts`           | the app, the emulators, the database proxy and the snapshots                  |
| `kit/`                      | the examples' shared styles                                                   |
| `tests/`                    | the tests, the invariants (`studio.ts`) and the database helpers              |

Last checked with @danwo/cli 0.1.2, Python 3.12, FastAPI 0.162, psycopg 3.3, stripe 16.0,
resend 2.50, Postgres 17 and Node 24.
