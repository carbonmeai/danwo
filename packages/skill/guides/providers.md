# Emulating a provider

danwo runs fake Stripe, Resend, S3 and Tigris, Auth0, Clerk, Google, Microsoft, Slack, GitHub, Twilio, Paystack, Flutterwave, Bachs, Composio, Nylas, Nango, Unipile, Pusher, Novu, Tiptap and the model APIs behind
an egress proxy, so the app talks to the real hostnames, unchanged, and tests can read and fault
what it did.

## The environment

A config's `environment()` runs once per worker. Start the emulators, start the app with the
proxy's environment variables, and return what tests need:

```ts
import { defineConfig, stripeEnvironment } from "@danwo/sdk"

export default defineConfig({
  readiness: { mode: "page+backend", settle: true },
  async environment() {
    let app: App | undefined
    const stripe = await stripeEnvironment({
      seed: () =>
        app && {
          webhookEndpoints: [
            {
              url: `${app.url}/webhooks/stripe`,
              events: ["checkout.session.completed"],
              secret: "whsec_test",
            },
          ],
        },
    })
    const start = async () => {
      app = await startApp(stripe.proxy.env({ ...process.env, STRIPE_SECRET_KEY: "sk_test_x" }))
      await stripe.reset()
    }

    await start()

    return {
      get baseUrl() {
        return app?.url
      },
      proxy: stripe.proxy,
      webhooks: stripe.emulator.webhooks,
      fixtures: stripe.fixtures,
      settle: stripe.settle,
      async reset() {
        await app?.stop()
        await start()
      },
      async close() {
        await app?.stop()
        await stripe.close()
      },
    }
  },
})
```

`proxy.env(...)` adds the proxy and its certificate to the app's environment, so Node and most
SDKs route through it without code changes. Seeds can be functions so they can point at the app
once it runs, and they are applied again after every reset.

## Any app, started by its own command

`appEnvironment({ app, services })` is what `danwo init` writes: it starts the services behind one
proxy, runs `app.command` (the dev server) through that proxy with `PORT` set from `app.url`, waits
until it answers, and stops it when the worker ends. `app` can instead be the URL of an app that
already runs, whose calls then reach the real providers. Resets put the services back to their
seeds; the app keeps running.

```ts
environment: () =>
  appEnvironment({
    app: { command: "pnpm dev", url: "http://localhost:3000" },
    services: [stripeService(), resendService()],
  }),
```

With more than one worker, each starts its own app: take its port from `await freePort()` (from
`@danwo/sdk`, a port on 127.0.0.1 nothing listens on) rather than a fixed one.

danwo leaves nothing running. The app's command runs as the leader of its own process group, so
stopping it stops what it started too (a dev command often runs the server as its own child): it gets
SIGTERM, then SIGKILL five seconds later. The same happens when a run ends, fails, is interrupted
(Ctrl-C, SIGTERM, SIGHUP) or is killed outright, since a small guardian process ends whatever a
worker owned once the worker is gone. Have the app exit on SIGTERM. An environment that starts
its own processes should start them with `spawnOwned()` from `@danwo/sdk`, which takes the same
arguments as `spawn()` and returns the child with a `stop()`. Windows has no process groups:
there the child's whole tree is ended with `taskkill /T /F /PID <pid>`, at once (no SIGTERM
grace), and the guardian does the same once its owner is gone, as long as the child it started
still runs to find the rest of the tree by.

`app.ready` changes when it counts as started: `{ path: "/health" }` waits for that path, and
`{ log: "worker ready" }` for a line in its output, for a worker that serves nothing, and
`{ exit: true }` for the command exiting 0, for one that starts a service and returns once it is up
(`docker compose up --wait --wait-timeout 60`); that exit is not the app going down. `app.stop` is
a shell command run when the app stops and when it fails to start (`docker compose down`, since
containers outlive the command), with its output added to the app's and 60 s to finish. Every
command gets an empty stdin, and readiness watches the command's exit, not its output closing, so
a daemon holding the pipe cannot stall it. A start that times out ends its error with the last 30
lines of output, or `(it printed nothing)`. Its output is kept in each run's flight record
(`processLogs`), redacted, line by line.

## Several apps

`stackEnvironment({ apps, services })` starts a frontend, the API it calls, a worker and a local
dev server together, all behind one proxy. Each app has its own `command`, `cwd`, `url`, `env` and
`ready` rule; `dependsOn` sets the start order (apps with nothing between them start together), and
`env` can be a function of the other apps' URLs, so the frontend points at the API it started.
`inheritEnv` (on `app` and on each stack app) says what the app inherits of danwo's own
environment under the proxy's variables and `env`: `true` (default, backward compatible)
everything; `false` only `PATH`, `HOME`, `USER`, `SHELL`, the temp folder, the locale (`LANG`,
`LC_*`), `TERM`, `TZ` and Windows' system variables; a list adds those names, `NAME_*` matching a
prefix. The default lets the runner's secrets (CI tokens, cloud keys, danwo's own
`AI_GATEWAY_API_KEY`) reach the app under test, where it may log or send them and records redact
only values danwo knows; `inheritEnv: false` closes that, at the cost of naming every variable the
app needs. Live-key warnings check the inherited environment, so fewer fire with it off:

```ts
environment: async () => {
  const inngest = await inngestService({ url: "http://127.0.0.1:8288" })

  return stackEnvironment({
    unmatched: "block",
    services: [stripeService(), clerkService(), inngest],
    apps: [
      {
        name: "web",
        command: "pnpm start",
        url: "http://localhost:3050",
        dependsOn: ["api"],
        env: ({ api }) => ({ VITE_API_URL: api }),
      },
      {
        name: "api",
        command: "node dist/apps/api/main.js",
        url: "http://localhost:4400",
        dependsOn: ["worker"],
        env: { ...inngest.env },
      },
      {
        name: "worker",
        command: "node dist/apps/worker/main.js",
        url: "http://localhost:4100",
        ready: { log: "worker ready" },
        env: { ...inngest.env },
      },
    ],
  })
}
```

The first app (or `baseUrl: "<name>"`) is the one the browser opens; tests get every app's URL as
the `apps` fixture. Each app's output goes into the flight record under its name.

A test's flight record holds only what happened during that test, so what the apps did while they
started is kept apart, in `.danwo/runs/<run>/environment-<worker>.json`: each app's startup output
(redacted, the last lines), the calls they made through the proxy (host, method, path without its
query, what the proxy did, the status; no headers or bodies), their sockets and danwo's notes. An
app that fails to start fails its test file with the app's name and the last lines of its output.

Two checks run as the apps start, and neither prints a value:

- **The preload.** danwo routes a Node app through its proxy by adding its preload to
  `NODE_OPTIONS`. A start script that sets `NODE_OPTIONS` itself (`NODE_OPTIONS=--max-old-space-size=8192
  nest start`) replaces it, and SDKs with their own HTTP agent (the official Stripe client) then
  call real hosts. danwo puts a `node` shim first on each app's PATH that loads the preload
  whatever `NODE_OPTIONS` says, and warns about any Node process of an app that still runs without
  it (`nodeShim: false` turns the shim off; Windows has no shim, so there a script must append to
  `NODE_OPTIONS` rather than replace it). A `NODE_OPTIONS` in an app's own `env` is joined with
  danwo's rather than replacing it. Stripe's client with its own `https.Agent`, axios with a custom
  agent and fetch with an undici `Agent` all go through the proxy.
- **The app's Node.** danwo needs Node 24, but an app process may run another Node (a volta, mise
  or asdf pin, a script calling a specific `node`, Docker). The preload routes **Node 20 and
  later**: Node 24.5+ and 22.21+ proxy fetch and their agents themselves (with
  `NODE_USE_ENV_PROXY`), 24.0-24.4 proxy only fetch, and on 20, 22.0-22.20 and 23 the preload
  tunnels every call through the proxy itself, following `NO_PROXY`. Node 18 and older are not
  supported. Before the app's code runs the preload calls a probe host only the proxy answers
  (with fetch, an `https.Agent` and an `http.Agent`); a process counts as preloaded only when all
  three reach it. One that misses prints `danwo: process <pid> runs Node <version>, and its calls
  do not go through danwo's proxy …`. Under `unmatched: "block"` or `secrets: "fail"` it exits at
  once and the run is refused with that line (`danwo refuses the run, because an app process does
  not go through its proxy`); otherwise it is a warning and a run note. The usual cause is a
  `NO_PROXY` that names every host.
- **Live keys.** With unrouted hosts passing through, a live-looking key (`sk_live_…`, an OpenAI or
  Anthropic key, an AWS access key…) for a provider the run does not emulate, in an app's
  environment or in a `.env` file in its folder that the run does not override, would reach the real
  provider. Each is a warning naming the variable and file; `secrets: "fail"` refuses to start,
  `secrets: "ignore"` stays quiet.

### Inngest

`inngestService({ url })` uses an Inngest dev server that runs at `url` (or starts one with
`start: true`, which runs `npx --yes inngest-cli dev`). Give each app `inngest.env`: it turns on
dev mode and points the SDK at `inngest.danwo.test`, which the proxy routes to the dev server, so
every event a test sends is in its flight record and `danwo matrix` can fault it (the dev server
down, an event accepted whose answer was lost, so a retrying app sends it twice, and a slow send).
`settle()` (and readiness with `settle: true`) waits until the function runs those events
triggered have finished, so an invariant reads what the background jobs wrote; the record lists
each run with its function, status and duration under `inngest`. An event no registered
function's trigger matches starts nothing and is not waited for; any other event that has not
started a run yet gets a few seconds from when it was sent for one to show (a dev server that
cannot list its functions' triggers gets that wait for every event). After `time.travel`, the
proxy moves each sent event's `ts` back to real time, as the dev server runs on it; otherwise
their runs would be scheduled days ahead. `step.sleep` still sleeps in real time.

## Hosts no service answers

Calls to hosts no service emulates pass through to the real host by default
(`unmatched: "passthrough"`), or get 502 with `unmatched: "block"`. Whichever you pick:

- **This machine always passes**: `localhost`, `127.0.0.1` and `::1`, where the apps a run starts
  and local servers such as Inngest dev answer. A `blocked` entry naming one of them still blocks it.
  A port of this machine nothing listens on gets 502 with "nothing is listening on
  127.0.0.1:8108; start that service or route the host", so a service the app needs but the run
  did not start (a search server, a cache) is named plainly.
- **`allow`** lists hosts that always pass, even under `block`.
- **`blocked`** lists hosts that get 502 even when others pass through.
- **Telemetry** (PostHog, Sentry, Segment, Amplitude, Datadog, hosted trace backends, Google
  Analytics and the like) is blocked by default, so a run neither sends real data out nor fills its
  record with noise; `telemetry: "passthrough"` lets it go.
- **Page assets** still pass under `block` (`assets: "passthrough"`, the default): a browser GET
  whose `Sec-Fetch-Dest` is `image`, `font`, `style`, `video`, `audio` or `track`, or, with no such
  header, a GET of an image or font file whose `Accept` starts with `image/` or `font/`. They are
  recorded as assets. Scripts, documents, frames, workers, `fetch()` (`empty`), non-GETs and a
  server's own calls stay blocked, and so do telemetry and `blocked` hosts. `assets: "block"`
  refuses page assets too.
- **What the pages were refused** is counted by host and kind. The run prints it once at the end,
  and each attempt's record carries it as a note (shown in the dashboard overlay): "Blocked hosts
  the pages tried to load: cdn.example.com (19 images), api.example.com (2 requests). Add the ones
  the app needs to `allow`, or set `assets: "passthrough"` for images and fonts."

The page loading itself (static files, and a dev server's modules and hot reload such as
`/@vite/client` or `/src/main.ts?v=…`) is in the flight record but left out of readiness, effects
and the matrix. A response that streams for as long as the client listens (server-sent events,
NDJSON) is recorded once its headers arrive and never holds readiness up.

### WebSockets

WebSockets go through the proxy too. Sockets to this machine and to passthrough hosts are passed
on; a routed host's sockets go to its `webSocket` endpoint, or are refused with 501 when its
emulator serves none; blocked hosts are refused with 403. Each socket is in the flight record
(`sockets`) with its frame counts and sizes, never the frames. `danwo matrix` tries every socket the
clean run opened twice more: with its upgrade refused, and with the connection dropped. A
browser's sockets always go through the proxy; Node does not proxy WebSockets on its own, so a
server-side WebSocket client reaches the proxy only when it is given a proxy agent.

## Isolation

Every test starts from the environment's seeded state, and so does every retry. Before a test runs,
its worker restores the snapshot it keeps: every emulator goes back to its seed (customers, mail,
sign-ins and OAuth grants, connected accounts, tool handlers set from test code), webhook queues
and the proxy's log are emptied, the clock is back to now, and data stores with a `snapshot()` and
`restore()` (`postgresSnapshot`, `sqliteSnapshot`, `redisSnapshot`) are restored. Restoring four
emulators takes about a tenth of a millisecond and a test-sized Postgres database tens of
milliseconds, so this costs next to nothing. A file's `beforeAll` work and
saved sessions' sign-ins are kept on top, so tests start signed in and set up without paying for it
again.

The worker keeps one snapshot per starting point, each in a named slot: the seeded state, the
file's `beforeAll` state, and one per saved session on top of either. A test that uses no session
starts from the seeded (or file's) state, never from another test's sign-in; a test using a
session restores that session's snapshot, kept the first time the session signed in. An
environment opts in with `snapshotSlots: true` and a `snapshot(slot)` and `restore(slot)` that keep
each slot apart. `startServices`, the emulators and `@danwo/data`'s snapshots all do; pass the slot
through:

```ts
snapshot: async (slot) => { await services.snapshot(slot); await db.snapshot(slot) },
restore: async (slot) => { await services.restore(slot); await db.restore(slot) },
snapshotSlots: services.snapshotSlots,
```

An environment without `snapshotSlots` keeps a single snapshot, of the seeded or file's state, and
each test that uses a session signs in again on top of it.

Change it with `isolation` in the config, or per file or describe block with `test.use({ isolation
})`: `"test"` (default), `"file"` (reset once per file; its tests build on one another) or `"none"`
(never reset; state carries from file to file in a worker). Each worker has its own environment, so
parallel workers never share state.

danwo cannot reach into the app's own memory. An app that keeps state in memory should offer a
test-reset endpoint, called from the environment's `restore()` (and `reset()`), as the shop example
does with `POST /__test/reset`. An environment with only `reset()` is reset before every test,
which usually means restarting the app; a file with `beforeAll` hooks is then reset once per file
instead, so its setup survives. An environment with neither keeps whatever state it has.

## Several providers

`startServices([stripeService({ seed }), s3Service(), slackService({ seed }), githubService()])`
composes services behind one proxy; its result has `fixtures`, `webhooks` (keyed by service),
`settle`, `reset` and `close` merged. Single-provider shortcuts: `stripeEnvironment`,
`s3Environment`, `auth0Environment`, `googleEnvironment`, `microsoftEnvironment`, `slackEnvironment`,
`githubEnvironment`, `composioEnvironment`, `nylasEnvironment`, `nangoEnvironment`,
`unipileEnvironment`, `awsEnvironment` (MiniStack for other AWS services).

## Reading what happened

Type the fixtures with `test.extend<StripeFixtures>()` and read the emulators in tests and
invariants: `resendInbox`, `s3Objects`, `auth0Tenant`, `gmailMailbox`, `googleCalendar`, `googleDrive`,
`outlookMailbox`, `outlookCalendar`, `oneDrive`, `graphSubscriptions`, `slackWorkspace`,
`githubRepo`, `twilioInbox` (and `twilioPhone` to text the app), `composioProject`,
`nylasApplication`, `nangoProject`, `unipileWorkspace`, and the `*SignIns` helpers. `danwo spec --topic emulators` lists them with their
signatures, and `--topic environments` the seed shapes.

## S3 and Tigris

`s3Service()` (or `s3Environment()`) answers S3 and Tigris on their own hosts: Tigris's
`t3.storage.dev` and `fly.storage.tigris.dev`, `s3.amazonaws.com` and `s3.us-east-1.amazonaws.com`
(add `endpoints` for other regions), path-style or virtual-hosted. The official AWS SDK
(`@aws-sdk/client-s3`, `lib-storage`, the presigners) and the Tigris SDK (`@tigrisdata/storage`)
work unchanged; `env()` hands the app what both read:

```ts
import { s3Environment } from "@danwo/sdk"

const s3 = await s3Environment({
  seed: {
    buckets: [{ name: "uploads" }],
    credentials: [{ accessKeyId: "tid_app", secretAccessKey: "tsec_app" }],
  },
})
const app = await startApp(s3.proxy.env({ ...process.env, ...s3.env() }))
```

`env()` sets `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (`auto`),
`AWS_ENDPOINT_URL_S3` and `AWS_ENDPOINT_URL`, and the Tigris SDK's `TIGRIS_STORAGE_ACCESS_KEY_ID`,
`TIGRIS_STORAGE_SECRET_ACCESS_KEY`, `TIGRIS_STORAGE_ENDPOINT` and `TIGRIS_STORAGE_BUCKET`, all
pointing at Tigris's endpoint (`env({ endpoint })` for another the service answers).

It answers objects (put, get with ranges, head, copy, Tigris's rename, delete and delete-many),
listings (v1 and v2, prefixes, delimiters, pages), multipart uploads with ListParts and
ListMultipartUploads, conditional reads and writes (`If-Match`, `If-None-Match`,
`If-Modified-Since`, `If-Unmodified-Since`, `If-None-Match: *` on put), the checksums a write
sends, presigned URLs and browser form uploads, and Tigris's presign call
(`POST /?func=presign`, which the Tigris SDK's `getPresignedUrl` uses). Errors are S3's
documents, naming the resource, bucket and key.

Signatures: with `credentials` seeded, each request's SigV4 signature (header or presigned URL)
is checked against the key's secret, and an unknown key or a wrong signature is refused as S3
refuses them (`InvalidAccessKeyId`, `SignatureDoesNotMatch`). Without any, every well-formed
signature is accepted.

A Tigris host gets Tigris's small differences (an empty `Owner` in listings, a
`ContinuationToken` element on every page, checksums on every full read, the copy's ETag as a
header, no `Location` in a completed upload); any other host gets AWS's. The emulator is checked
against Tigris live (`danwo fidelity s3`). `s3Objects(s3.emulator)` reads what the app stored.

Not emulated: versioning, object lock, tagging, lifecycle, CORS and the other bucket
subresources (answered 501), server-side encryption headers, bucket management through
Tigris's own API, and the Tigris SDK's snapshots, forks and bundles.

## Stripe

`stripeService()` (or `stripeEnvironment()`) answers `api.stripe.com` and `checkout.stripe.com`:
customers, products and prices, payment intents and refunds, invoice items for usage, Checkout
Sessions with the hosted page, events and webhooks signed as Stripe signs them, so `stripe` and
`@stripe/stripe-js` work unchanged.

On the hosted Checkout page (`checkout-pay` pays, `checkout-cancel` returns to `cancel_url`) the
card number field holds `4242 4242 4242 4242`; typing `4000 0000 0000 0002` declines it as Stripe
does: an alert with test id `checkout-error`, the session stays open, no event is sent, and the
payer can try another card. `danwo matrix` also tries the page's Pay as a declined card
(the fault `card_declined`), whatever card the test typed.

### Subscriptions and billing

- **Setup intents**: create, confirm, retrieve, cancel and list.
- **Subscriptions**: create, retrieve, update, cancel and list, with `trial_period_days` or
  `trial_end`, `payment_behavior` (including `default_incomplete`), `cancel_at_period_end`,
  `trial_end=now` and price swaps. Statuses move through `incomplete`, `trialing`, `active`,
  `past_due`, `canceled` and `incomplete_expired`.
- **Invoices**: `pay`, `create_preview`, and lists filtered by subscription.
- **The billing portal**: sessions, with a hosted page that cancels at the period's end.
- **Checkout** in subscription mode, with `subscription_data.trial_period_days`, and in setup
  mode, where the hosted page's Save card attaches the typed card to the customer through a
  SetupIntent (`session.setup_intent`, with `setup_intent_data.metadata`); `4000 0000 0000 0002`
  is refused, `4000 0000 0000 0341` saves and declines later.
- **Webhooks**: `customer.subscription.created`, `.updated`, `.deleted` and `.trial_will_end`;
  `invoice.created`, `.finalized`, `.paid`, `.payment_succeeded`, `.payment_failed` and
  `.payment_action_required`; `setup_intent.created`, `.succeeded`, `.setup_failed` and
  `.requires_action`; and `checkout.session.completed` for subscriptions. They are signed on the
  apps' clock, so deliveries after time travel are not refused as stale.

Renewals, trial ends, trial-ending notices and incomplete expiry run on the emulator's clock, so
time travel bills each period. Stripe's test payment methods decide the outcome:
`pm_card_chargeDeclined` is declined even when saving the card, `pm_card_chargeCustomerFail`
saves but every charge is declined (a renewal goes `past_due` until `invoices.pay` succeeds), and
`pm_card_authenticationRequired` leaves the intent `requires_action`. Seed prices as `recurring`,
with a `lookup_key` and a `nickname`, so an app's plans table can match them.

### Stripe.js

`stripeService` also answers `js.stripe.com`, with a stand-in for Stripe.js: the real script
talks to Stripe's own iframes and cannot run against an emulator. A page that loads it (directly,
or through `loadStripe` and `@stripe/react-stripe-js`) gets `Stripe(key)` with `elements()`, and
card, card number, expiry, CVC, payment, address and link elements mounted as plain inputs a test
fills by label ("Card number", "Expiration date", "Security code"; the address element's "Full
name", "Address line 1" and so on). Stripe's test numbers decide the outcome: `4242 4242 4242 4242`
succeeds, `4000 0000 0000 0002` is declined, `4000 0025 0000 3155` needs authentication.
`createPaymentMethod`, `confirmCardPayment`, `confirmCardSetup`, `confirmPayment`, `confirmSetup`,
`retrievePaymentIntent` and `retrieveSetupIntent` call the emulator with the publishable key and
the intent's client secret, as Stripe.js does; `redirectToCheckout({ sessionId })` opens the hosted
page, and `paymentRequest()` reports no wallet. The emulator accepts a `pk_test_` key only on those
calls, and on an intent only with its own client secret. Loading the script counts as the page
loading, so it stays out of effects and the matrix.

## Twilio

`twilioService()` answers the Messages API and Verify on Twilio's hosts, and keeps every text a
test can read like mail, so SMS codes replay too. It also answers the account
(`/2010-04-01/Accounts/{sid}.json`) and its phone numbers (`IncomingPhoneNumbers.json`).

Seed an account as `Trial` or `Full` (`Full` by default). A trial account sends only to its
verified recipients and refuses as Twilio's trial accounts do, in Twilio's order: no recipient
(21604), a malformed parameter (`0`), a missing body (`0`), then an unverified recipient (422,
`572002`). A full account refuses an invalid recipient with 21211 and a sender it does not own
with 21606.

## Auth0

`auth0Environment({ seed })` (or `auth0Service` in `startServices`) answers `<tenant>.auth0.com`,
the regional domains and the seed's `custom_domains`. The app keeps its real `AUTH0_DOMAIN`, and
the browser logs in on the hosted page through the same proxy:

```ts
const auth0 = await auth0Environment({
  seed: {
    tenants: [
      {
        domain: "acme.us.auth0.com",
        post_login_claims: { "https://acme.test/plan": "pro" },
        roles_claim: "https://acme.test/roles",
        clients: [{ client_id: "web", client_secret: "s", name: "Web", callbacks: [callback] }],
        apis: [
          {
            identifier: "https://api.acme.test",
            scopes: ["read:orders"],
            rbac: true,
            permissions_in_token: true,
          },
        ],
        roles: [
          {
            name: "admin",
            permissions: [
              {
                resource_server_identifier: "https://api.acme.test",
                permission_name: "read:orders",
              },
            ],
          },
        ],
        users: [
          {
            email: "ada@acme.test",
            password: "Analytical-1",
            email_verified: true,
            roles: ["admin"],
          },
        ],
      },
    ],
  },
})
```

- Pages: `/u/login` ("Email address", "Password", "Continue"), `/u/signup`, and
  `/u/mfa-otp-challenge` for users seeded with `mfa_secret` (compute the code with
  `auth0OtpAt(secret, new Date())`). Errors read as on Auth0: "Wrong email or password".
- Tokens: authorization code with PKCE, refresh tokens (`refresh_token: { rotation: "rotating" }`,
  where reusing a rotated token revokes its family), client credentials (with `client_grants` or
  `management_scopes`) and the password grant. Post-login claims come from the seed; no Action
  code runs.
- Social buttons: seed `connections` (`google-oauth2`, `github`, `windowslive`) and pass the
  provider's service as `social: [google]`. Its OAuth client needs
  `https://<tenant>/login/callback` as a redirect URI.
- Management API v2: users and Lucene search, roles, permissions, organizations, blocks and
  verification-email jobs, with Auth0's errors and rate-limit headers.
- Read it with `auth0Tenant(auth0)`: `users()`, `user(email)`, `logins(email)`,
  `liveRefreshTokens(clientId)`, `emails(to)` (verification links), `block(email)`.
- Faults: the token endpoint (429, 5xx, delay, reset, a refused refresh), JWKS and `/userinfo`
  outages, and Management API errors. The login pages are never faulted.

Not emulated: the implicit and device flows, passwordless, SAML and enterprise connections,
log streams, and Lucene ranges or parentheses (the Management API answers 400).

## Clerk

`clerkEnvironment({ seed })` (or `clerkService` in `startServices`) plays a Clerk development
instance on its real hosts: the Backend API on `api.clerk.com`, the Frontend API on
`<slug>.clerk.accounts.dev` and the Account Portal on `<slug>.accounts.dev`. Read the keys with
`clerkInstance(clerk.emulator).instance` and give the app `CLERK_PUBLISHABLE_KEY` and
`CLERK_SECRET_KEY`; `@clerk/express`, `@clerk/nextjs` and `@clerk/backend` then run unchanged,
dev-browser handshake included.

```ts
const clerk = await clerkEnvironment({
  seed: {
    instance: { password: true }, // false: sign in by emailed code
    users: [{ email: "ada@danwo.test", password: "s3cret-pass" }],
    organizations: [{ name: "Acme", members: [{ email: "ada@danwo.test", role: "org:admin" }] }],
  },
})
const { publishableKey, secretKey } = clerkInstance(clerk.emulator).instance
```

The page loads ClerkJS and `<SignIn/>` from the Frontend API host
(`/npm/@clerk/clerk-js@6/dist/clerk.browser.js` and `/npm/@clerk/ui@1/dist/ui.browser.js`), as it
does from Clerk. The emulator serves the app's own installed `@clerk/clerk-js` and `@clerk/ui`
when their major version fits, and otherwise downloads the published (MIT) build once from a
public npm CDN into `~/.cache/danwo/clerk`. Sign-in works with a password or an emailed code;
`clerkService` hands its codes to the `mail` fixture (`startServices` collects every service's
mail sources), so `mail.code(email)` and the agent read them. Session tokens are RS256 JWTs with
Clerk's claims, valid 60 seconds.

**Ids that survive resets.** Seeded users get ids derived from their email address
(`stableClerkId("user", email)`), organizations from their slug or name, and memberships from
both, so they are the same on every run and after every reset, and match the rows an app's own
database was seeded with. Give `id` on a seeded user or organization to pick it yourself.

**Webhooks.** Seed `webhooks: [{ endpoint, events?, secret? }]` and the emulator sends Clerk's
events there, signed the Svix way (`svix-id`, `svix-timestamp`, `svix-signature`) so
`verifyWebhook` from `@clerk/backend/webhooks` (or `svix`) accepts them: `user.created`,
`user.updated`, `user.deleted`, `session.created`, `session.ended`, `session.removed`,
`session.revoked`, `organization.created`, `organization.updated`, `organization.deleted` and
`organizationMembership.created`, `.updated` and `.deleted`. Users made by the Backend API and by
sign-up send `user.created`. Without a `secret`, the endpoint's secret is derived from the
instance and the endpoint, the same on every run: `clerkInstance(clerk).webhookSecret()` reads it.
Seeded records send nothing unless the seed sets `announce: true`; then they arrive as if just
made, for apps that create their own rows from `user.created`. Deliveries go through the shared
webhook dispatcher, so `danwo matrix` duplicates, delays, forges and replays them stale.

**Verifying tokens offline.** Apps that check session tokens with a public key instead of the
Backend API (`CLERK_PEM_PUBLIC_KEY`, `CLERK_JWT_KEY`, `jwtKey`) get it from
`clerkInstance(clerk).publicKeyPem()`; `env()` returns that and every key variable the SDKs read.
Seed `instance.signingKey` (a PKCS#8 PEM) to keep one key across runs, and `instance.origin` (the
app's origin) to put it in the `azp` of tokens the Backend API mints, so `authorizedParties`
checks pass for those too; tokens minted for the browser carry its `Origin`.

In tests, `clerkInstance(clerk)` reads users (`user(email)`, `users()`: every one, oldest first,
seeded, signed up or made through the Backend API, each with its linked `external_accounts`),
sessions, organizations, memberships (`memberships(orgId?)`: id, organization, user and role) and
codes, so an invariant can compare the app's own rows with Clerk's. The view types are danwo's
own (`ClerkUserView`, `ClerkSessionView`, `ClerkOrganizationView`, `ClerkMembershipView`;
`ClerkUser` was renamed `ClerkUserView`), and `stableClerkId` is exported from `@danwo/sdk`. And
`revokeSessions(email)` signs a user out everywhere mid-test: the next token refresh is refused
and the next handshake signs the app out. `danwo matrix` faults the Backend API (429 with
`Retry-After`, 500, 503, a slow answer, resets), the signing keys and handshake payloads (500,
reset) and ClerkJS's token refresh (500, 503). Recordings redact `sk_test_` keys, session
tokens, Clerk cookies, dev browser tokens and handshake nonces.

**Google sign-in.** Seed `social: [{ provider: "google", clientId, clientSecret }]` and pass
`clerkService({ social: [googleService({ seed })] })`, with the same OAuth client seeded on Google
(redirect URI `https://<slug>.clerk.accounts.dev/v1/oauth_callback`). "Continue with Google" goes
to the Google emulator's chooser and back to `/v1/oauth_callback`; a new person is signed up
(ClerkJS's transfer), one whose email Clerk has is signed in with Google linked.

**Organizations in the browser and invitations.** The Frontend API answers
`<OrganizationSwitcher/>` (`/v1/me/organization_memberships`, invitations, suggestions, creating an
organization). A Backend API invitation emails the invitee (`clerkInstance(clerk).messages(email)`,
`mail.link(email, { match: "ticket" })`) a `/v1/tickets/accept` link that lands on its
`redirect_url` with `__clerk_ticket`; `<SignUp/>` or `<SignIn/>` there joins them to the
organization. `img.clerk.com` (avatars, provider logos) is served too.

Not emulated: social sign-in other than Google, enterprise sign-in, phone codes, passkeys, MFA,
waitlists, billing, and the `email.*`, `sms.*`, invitation, role, permission and billing webhooks.

## Composio

`composioEnvironment({ seed, backends })` emulates Composio (`backend.composio.dev`, both
`/api/v3` and `/api/v3.1`) for apps that give agents tools through `@composio/core`: toolkits and
tools, `tools.execute`, auth configs, connected accounts (`link`, `initiate`, `waitForConnection`,
refresh, enable and disable), trigger types and instances, and the project's webhook
subscription. Seed API keys (only those are accepted when given), auth configs, connected
accounts with their credentials, triggers, the webhook URL and secret, custom toolkits and tools,
and canned `results` per tool.

```ts
const composio = await composioEnvironment({
  seed: {
    authConfigs: [{ id: "ac_gmail", toolkit: "gmail" }],
    webhook: { url: `http://127.0.0.1:${port}/webhooks/composio`, secret: "whsec_inbox" },
  },
  backends: [googleService({ seed: { users: [{ email: "ada@inbox.test", name: "Ada" }] } })],
})
```

With `backends`, the toolkits act on those emulators: a link sends the browser to that
emulator's own account chooser (Composio's managed app is registered there on first use, with
PKCE), the code is exchanged on its token endpoint, and tools call its real API with the
account's token, so `GMAIL_SEND_EMAIL` lands in `gmailMailbox(google, email).sent()`,
`SLACK_SEND_MESSAGE` in `slackWorkspace(slack).messages(channel)`, `GITHUB_CREATE_AN_ISSUE` in
`githubRepo(github, repo).issues()` and `OUTLOOK_SEND_EMAIL` in Outlook's sent items. A 401 from
the backend refreshes the token once; when that fails the account turns `EXPIRED` and the
`composio.connected_account.expired` webhook goes out (revoke a Google grant to see it). Without
a backend, the hosted link shows Composio's own page (Connect or Cancel) and tools answer from
seeded results or sample data. Either way the link ends on the app's callback URL with
`status` and `connected_account_id`.

In tests, `composioProject(composio)` reads accounts and every tool run (with whether a seed, the
backend or a sample answered), `fire(trigger, data)` sends a signed `composio.trigger.message`
webhook for each enabled instance, and `expire(accountId)` expires an account;
`composioTools(composio).handle(slug, fn)` answers a tool from the test. `danwo matrix` faults
tool execution (429 with `retry-after`, 503, 408, 422 for an expired account, a 200 with
`successful: false`, a slow answer, resets before and after Composio acted), starting a
connection (429, 500, reset) and other API calls (500, reset); the hosted link and the OAuth
callback are pages and are left alone. Recordings redact `ak_` and `uak_` keys.

Not emulated: Tool Router sessions and MCP servers, files, custom tools defined in code, poll
triggers watching the backend on their own (fire them with `fire`), V1 and V2 webhook payloads,
and the exact error codes beyond the two key errors, which are approximations.

## Connector platforms

Apps that reach their users' mailboxes, calendars, CRMs and LinkedIn or WhatsApp inboxes
through a connector platform get each one emulated on its real hosts, for the app's server and the
browser's hosted connect pages alike. `danwo matrix` faults their sends and writes (rate limits,
the provider's own refusals, a revoked or disconnected account, slow answers, dropped connections,
a dropped answer after the provider acted) and their reads with rate limits and server errors; the
hosted pages are left alone. Error codes beyond the key errors are approximations. The three are seeded together like this:

```ts
stackEnvironment({
  services: [
    nylasService({
      seed: {
        apiKeys: [key],
        grants: [{ id: GRANT, email: "rep@sales.test" }],
        webhooks: [{ url, secret }],
      },
    }),
    nangoService({
      seed: {
        secretKeys: [secret],
        integrations: [{ key: "hubspot" }],
        connections: [{ integration: "hubspot", connectionId: "rep-1" }],
        webhook: { url },
      },
    }),
    unipileService({
      seed: {
        tokens: [token],
        accounts: [{ id: "acc_rep", type: "LINKEDIN", name: "Rep", username: "rep" }],
      },
    }),
  ],
  apps: [
    { name: "app", command: "node app.ts", url, env: { UNIPILE_DSN: "api8.unipile.com:13851" } },
  ],
})
```

Nylas, Nango and Unipile each have a section of their own.

## Nylas

The `nylas` and `@nylas/connect` SDKs work against it unchanged.

**Nylas v3** (`api.us.nylas.com`, `api.eu.nylas.com`): hosted auth (`/v3/connect/auth`, the
token exchange with the API key or a PKCE verifier as `@nylas/connect` sends, token info,
revoke) and grants; messages, threads, drafts, folders and attachments; calendars, events and
free/busy; contacts; the scheduler's configurations, availability and bookings; webhooks signed
with `X-Nylas-Signature`. Mail sent between two seeded grants lands in the other's inbox. Seed
grant ids to match the app's database; they survive resets. `nylasApplication(nylas)` reads
grants, mail and events, delivers mail from outside (`receive`) and expires a grant (`expire`,
which sends `grant.expired`).

Recordings redact `nyk_` keys and the `nyat`, `nyrt` and `nyid` tokens Nylas hands out.

Not emulated: notetakers, smart compose and ICS, and grants backed by the Google or Microsoft emulators.

## Nango

The `@nangohq/node` and `@nangohq/frontend` SDKs work against it unchanged.

**Nango** (`api.nango.dev`, with the Connect UI on `connect.nango.dev`): integrations, connect
and reconnect sessions, the Connect UI the frontend SDK opens (it answers the `ready` /
`session_token` handshake and posts `connect` back), connections whose tokens refresh on the
emulator's clock, the proxy, actions and records, and `auth` webhooks signed with both
`X-Nango-Signature` and `X-Nango-Hmac-Sha256`. Proxied calls answer from the seeded `proxy`
answers, or go to a backend emulator: `nangoService({ backends: [...] })` with the Google,
Microsoft, Slack or GitHub service forwards a connection's calls with its access token, so seed
the connection with a token that emulator issued. `nangoProject(nango)` reads connections and
every proxied call and action, and `revoke` makes a connection's next refresh fail with Nango's
refresh error and an `auth` webhook.

Recordings redact Nango's connect session tokens.

Not emulated: syncs running on their own, and Nango's MCP endpoints.

## Unipile

The `unipile-node-sdk` works against it unchanged.

**Unipile** (every `*.unipile.com` DSN, and the hosted auth pages on `account.unipile.com`):
hosted auth links that notify the link's `notify_url` and send the browser to the success URL;
LinkedIn, WhatsApp and mail accounts; the owner's and other profiles; chats, messages and
attendees; mail; and webhooks for `messaging`, `email` and `account_status`, each delivered with
the headers its subscription named (Unipile signs nothing). Answers match the shapes the SDK
validates with `validateRequestPayload`. `unipileWorkspace(unipile)` lets a lead message the
account (`receive`, which sends `message_received`), delivers mail (`receiveEmail`) and
disconnects an account (`disconnect`, which sends `CREDENTIALS`).

Not emulated: posts beyond empty lists, invitations, attachments and calendar.

## Realtime providers

Three providers apps use for realtime features, each with a socket the browser keeps open. The
proxy sends a WebSocket upgrade to one of their hosts to a local port the emulator serves, so
`pusher-js`, Novu's Inbox and Tiptap's collaboration provider connect with no change to the app.
`danwo matrix` faults every socket the clean run opened (upgrade refused, connection dropped), and a
reset closes the open sockets so clients reconnect to the seeded state.

```ts
import { novuService, pusherService, stackEnvironment, tiptapService } from "@danwo/sdk"

const services = [
  pusherService({
    seed: { apps: [{ id: "4242", key: "app-key", secret: "app-secret", cluster: "eu" }] },
  }),
  novuService({
    seed: { apiKey: "novu-secret", bridgeUrl: "http://127.0.0.1:4400/api/novu-bridge" },
  }),
  tiptapService({ seed: { apps: [{ id: "notes", secret: process.env.TIPTAP_COLLAB_SECRET }] } }),
]
```

Pusher, Novu and Tiptap each have a section of their own.

## Pusher

**Pusher** (`*.pusher.com`) answers the Channels API the server SDKs sign (triggers, batches,
channel info, presence users, ending a user's connections) and checks each signature, body hash
and timestamp. On the socket it speaks the protocol `pusher-js` does: public, private and
presence channels (authorised as the app's auth endpoint would), user sign-in, client events and
pings. Seeded apps' webhooks (`channel_occupied`, `member_added`, `client_event`, …) are signed
with the app's secret. Channel info carries `subscription_count` only for an app seeded with
`subscriptionCounting: true`; otherwise asking for it is refused with Pusher's 400, as on a real
app with subscription counting off (the default). Beams publishes and the device API are kept for
tests. Without a seed it
answers for `PUSHER_DEFAULTS`. In tests, `pusherChannels(pusher)` lists what was published, on
which channel and which connections it reached, lists open connections, and publishes from the
test; `pusherBeams(pusher)` reads push publishes and registered devices.

`danwo matrix` faults triggers with 429, 500 and lost answers, as well as the sockets. Recordings redact
Pusher's signatures.

Not emulated: encrypted channels, watchlist events and the SockJS fallback.

## Novu

**Novu** (`api.novu.co`, `socket.novu.co`, and the EU hosts) answers `@novu/api`: triggers
(one, bulk, broadcast, cancel), v2 subscribers, credentials, topics and a subscriber's
notifications, with each write replayed under its `idempotency-key` as Novu does. A workflow
seeded as templates runs at once; a code-first workflow runs step by step through the app's
`@novu/framework` bridge, with requests signed with the secret key, as Novu Cloud runs it.
In-app messages reach the Inbox the browser opened (`@novu/react`, `@novu/js`) and its socket;
email steps go through a Resend service given as `email`. `settle` waits for the workflow runs.
`novuProject(novu)` reads runs (with each step's status and outputs), messages and Inboxes.

`danwo matrix` faults triggers with 429, 500, a reset and a lost answer, and the Inbox session with a
failure. Recordings redact Novu's `ApiKey` header and Inbox tokens.

Not emulated: digests and delays (run straight through), preferences beyond the defaults, and SMS, chat
and push delivery (kept, not sent).

## Tiptap

**Tiptap Cloud** (`<appId>.collab.tiptap.cloud`) is the collaboration server: editors connected
with `@hocuspocus/provider` or `TiptapCollabProvider` sync a document over the Yjs protocol,
see each other's cursors, and get Tiptap's stateless messages. Tokens are checked against the
app's secret, with `allowedDocumentNames` and `readonlyDocumentNames`. The REST API reads a
document as JSON or a Yjs update, creates, replaces (editors receive the change) and deletes it.
`tiptapCollab(tiptap)` reads a document's JSON or text, waits for text, writes one, counts its
editors, and makes trouble: `trouble({ permissionDenied: true })` refuses tokens and
`trouble({ syncDelayMs })` slows syncs.

`danwo matrix` faults the REST API with 429, 500 and resets, as well as the sockets.

Not emulated: document versions, AI and the conversion APIs.
