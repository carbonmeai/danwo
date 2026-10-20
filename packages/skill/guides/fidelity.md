# Checking the emulators against the real providers

`danwo fidelity` runs one scenario suite per provider against the emulator and, with sandbox
credentials, against the provider's own sandbox, then compares the answers by structure: status
codes, error codes, and the JSON's keys, types, nesting and fixed values. Ids, times, amounts and
secrets never take part.

## Running it

```sh
danwo fidelity                    # every provider, emulator against the committed goldens
danwo fidelity stripe resend      # some providers
danwo fidelity stripe --update-golden   # with sandbox keys set: record the sandbox as the golden
danwo fidelity --from-openapi     # goldens from each provider's published API description
danwo fidelity --offline          # never call a sandbox, even with keys set
danwo fidelity --keep             # leave what a live run made in place, to look at it
danwo fidelity --sweep stripe     # list tagged leftovers in the sandboxes; add --yes to remove them
```

Without credentials it checks the emulator against `fidelity/<provider>.json`. That offline check
runs in `bun run check`, so an emulator change that breaks fidelity fails without any keys. Each
difference prints with its scenario and step, classified as a missing field, an extra field, a type
mismatch, a status mismatch, an error-code mismatch, an ordering difference or a missing step.

## Suites

| Provider                         | Scenarios                                                                                                                                                                                                                                                         | Live run reads                                                                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe                           | customers, paging, errors, idempotency, products and prices, payment intent and refund, checkout session, events                                                                                                                                                  | `DANWO_FIDELITY_STRIPE_KEY` (`sk_test_` or `rk_test_`)                                                                                                         |
| Resend                           | send and read back, batch, idempotent send, errors, domains                                                                                                                                                                                                       | `DANWO_FIDELITY_RESEND_KEY`; sends only to `delivered@resend.dev`                                                                                              |
| Twilio                           | test credentials: send from the magic test number, invalid recipient and unowned sender; live credentials (sending nothing): the account, its numbers and messages, bad credentials, a missing message, no recipient, and a trial or full account's refused sends | `DANWO_FIDELITY_TWILIO_ACCOUNT_SID`, plus an API key (`DANWO_FIDELITY_TWILIO_API_KEY_SID`, `_API_KEY_SECRET`, preferred) or `DANWO_FIDELITY_TWILIO_AUTH_TOKEN` |
| Paystack                         | initialize and verify, customers, banks, errors                                                                                                                                                                                                                   | `DANWO_FIDELITY_PAYSTACK_KEY` (`sk_test_`)                                                                                                                     |
| Flutterwave                      | hosted payment link, banks, key errors                                                                                                                                                                                                                            | `DANWO_FIDELITY_FLUTTERWAVE_KEY` (`FLWSECK_TEST-`)                                                                                                             |
| Bachs                            | customers, errors                                                                                                                                                                                                                                                 | `DANWO_FIDELITY_BACHS_KEY` (`sk_sandbox_`)                                                                                                                     |
| Slack, GitHub, Google, Microsoft | public calls: `api.test` and token errors, a public repository and a 404, sign-in discovery and signing keys                                                                                                                                                      | `DANWO_FIDELITY_PUBLIC=1`, plus an optional `DANWO_FIDELITY_GITHUB_TOKEN`                                                                                      |
| Composio                         | key errors live; with a key, a toolkit, a tool, a trigger type, auth configs and connected accounts (reads only)                                                                                                                                                  | `DANWO_FIDELITY_PUBLIC=1`; optional `DANWO_FIDELITY_COMPOSIO_KEY` (a test project's `ak_` key)                                                                 |
| Pusher                           | triggers (with channel info), a batch, one channel and the occupied channels                                                                                                                                                                                      | `DANWO_FIDELITY_PUSHER_APP_ID`, `_KEY`, `_SECRET`, `_CLUSTER` (a test app)                                                                                     |
| Novu                             | key error live; with a key, a subscriber created, read, patched and deleted                                                                                                                                                                                       | `DANWO_FIDELITY_PUBLIC=1`; optional `DANWO_FIDELITY_NOVU_KEY` (a development environment)                                                                      |
| Tiptap                           | a document created from JSON, read as JSON, deleted, then missing                                                                                                                                                                                                 | `DANWO_FIDELITY_TIPTAP_APP_ID`, `DANWO_FIDELITY_TIPTAP_API_SECRET`, optional `DANWO_FIDELITY_TIPTAP_DOC_PREFIX`                                                |
| Clerk                            | users, organizations with members and invitations, sessions and tokens, signing keys, errors; the browser's sign-up and sign-in by emailed code, and the session token it ends in                                                                                 | `DANWO_FIDELITY_CLERK_SECRET_KEY` (`sk_test_`) and `DANWO_FIDELITY_CLERK_PUBLISHABLE_KEY` (`pk_test_`) of a development instance                               |
| AI Gateway (`gateway`)           | language model text, tool call, structured output, stream events, embedding, errors (unknown model, no key, malformed prompt)                                                                                                                                     | `DANWO_FIDELITY_AI_GATEWAY_KEY`, else `AI_GATEWAY_API_KEY`                                                                                                     |
| Gemini (`gemini`)                | text, function call, structured output, stream events, token counting, embeddings, no key                                                                                                                                                                         | `DANWO_FIDELITY_GEMINI_KEY` (a Google AI Studio key)                                                                                                           |
| Perplexity (`perplexity`)        | Agent API text, function call, structured output, stream events; Sonar with citations; no key                                                                                                                                                                     | `DANWO_FIDELITY_PERPLEXITY_KEY`                                                                                                                                |
| Nylas                            | key errors; with a key, the application's grants listed and one read (reads only)                                                                                                                                                                                 | `DANWO_FIDELITY_PUBLIC=1`; optional `DANWO_FIDELITY_NYLAS_KEY`                                                                                                 |
| Nango                            | key errors; with a key, the project's integrations and connections (reads only)                                                                                                                                                                                   | `DANWO_FIDELITY_PUBLIC=1`; optional `DANWO_FIDELITY_NANGO_KEY` (a development environment)                                                                     |
| Unipile                          | an unknown token; with a key, the connected accounts (reads only)                                                                                                                                                                                                 | `DANWO_FIDELITY_UNIPILE_DSN`, `DANWO_FIDELITY_UNIPILE_KEY`                                                                                                     |
| Bedrock (`bedrock`)              | Converse text and tool call, InvokeModel with Nova's body, unsigned call                                                                                                                                                                                          | `DANWO_FIDELITY_BEDROCK_API_KEY` (a Bedrock API key), optional `DANWO_FIDELITY_BEDROCK_REGION`                                                                 |

Keys come from the environment, or from `.env.fidelity` and then `.env` at the repository root,
which git ignores; neither file has to exist. The gateway suite drives the AI SDK's own gateway provider, so each request is
the one an app sends; it uses the cheapest models and 20 output tokens, so a live run costs a small
fraction of a cent, which the gateway reports in each answer's cost metadata.

## Safety

- Only test and sandbox credentials. A key that looks live (`sk_live_`, `rk_live_`, a Flutterwave
  key without `_TEST`, anything but `sk_sandbox_` for Bachs, a Clerk key that is not `sk_test_` or `pk_test_`) stops the run with `CONFIG_INVALID`.
  The AI Gateway, Gemini, Perplexity and Bedrock have no sandbox, so their keys are real ones; with
  such a key in the environment, `.env.fidelity` or `.env`, a plain `danwo fidelity` runs that suite
  live too (use `--offline` to stay off the network). Each live run uses the cheapest model and 20
  output tokens. Bedrock's streaming calls answer in AWS's binary event stream, which the suites do
  not read; their framing is covered by tests that drive the AWS SDK.
- Keys are never printed or written. Every answer goes through the recorder's redaction before it
  is shaped, and goldens hold structure only.
- Scenarios clean up what they create (see below), and each makes a handful of requests.
- Twilio runs one of two ways, by the credentials. Each scenario first reads the account: test
  credentials cannot (Twilio answers 403), so they run the magic-number scenarios, which send and
  bill nothing. Live credentials, an Auth Token or better an API key (`SK…` and its secret, so the
  main Auth Token need not be stored), never send: the suite reads the account, its numbers and its
  messages, and makes only sends Twilio refuses before a message exists. Every refused send names a
  sender the account is first checked not to own and no Messaging Service, so none can go out, and
  the account's messages to that recipient are counted afterwards and must be none. A trial account
  refuses with its own codes (`0` for a malformed or missing parameter, `572002` for a recipient it
  has not verified); a full account with `21211` and `21606`. A successful send's shape is checked
  against the published API reference only, unless test credentials are set.
- Tiptap documents are named `<DANWO_FIDELITY_TIPTAP_DOC_PREFIX><tag>`, so a shared app can keep
  the suite's documents apart from its own.
- Clerk runs use Clerk's test addresses (`…+clerk_test@example.com`, which take the code `424242`),
  so a development instance sends no mail, and delete every user and organization they make. The
  token checks compare a session token's claim and header names and verify it with
  `@clerk/backend` against the key that signed it. Clerk's webhooks are checked without keys: the
  emulator's `user.*`, `organization.*` and `organizationMembership.*` payloads are compared with
  the Backend API shapes in the Clerk golden, and each delivery must pass `verifyWebhook`.

## Goldens and known differences

A golden records, per scenario step, the status and the shape of the answer. Where it came from is
in its `source`: `live` for a sandbox run, `openapi` for one derived from an API description or,
for providers that publish none, from the documented answers written into the suite.

`fidelity/known-differences.json` lists differences accepted on purpose, each with its reason: a
field the emulator cannot give honestly, a check it skips by design (it accepts any well-formed test
key), or seed data that differs from the real account. Match by provider, scenario, step, kind and
path (a path ending in `.` covers everything under it).

## Cleaning up

Everything a live run makes is named or tagged `danwo-fidelity`: a run tag
`danwo-fidelity-<unique>` goes into Stripe customer emails and product names, Clerk test addresses,
external ids and organization names, Novu subscriber ids, Tiptap document names, Flutterwave
references, Bachs addresses, Pusher channels and Resend subjects.

Each create registers its undo with the run's cleanup ledger, by provider, kind and id. After every
scenario, whether it passed, failed or threw, the ledger undoes in reverse order, retrying each undo
once; a 404, a 410 or an answer that says the object is already gone or final counts as undone.
Ctrl-C undoes what the open scenarios made before the process exits. Whatever could not be undone
is printed per provider under "left behind", by kind and id (never a secret), and in the closing
line, and fails the run. `--keep` leaves everything in place on purpose and lists it as kept.

`danwo fidelity --sweep [providers]` lists what earlier runs left in the sandboxes. It only ever
removes resources carrying the tag, and only with `--yes`; look-alikes from before tagging are
listed for you to judge and never touched.

| Provider    | Undone after each scenario                                                                                           | Cannot be removed                                                                                                                                                        | Sweep                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Stripe      | customers deleted, subscriptions and setup intents canceled, products and prices archived, Checkout Sessions expired | payment intents, refunds and expired sessions stay in the test-mode history; products Stripe makes for inline line items cannot be archived                              | tagged customers deleted, tagged products archived with their prices |
| Clerk       | users and organizations deleted, invitations and sessions revoked                                                    | nothing                                                                                                                                                                  | tagged users and organizations deleted                               |
| Novu        | subscribers deleted                                                                                                  | nothing                                                                                                                                                                  | tagged subscribers deleted                                           |
| Tiptap      | documents deleted                                                                                                    | nothing                                                                                                                                                                  | prefixed, tagged documents deleted                                   |
| Paystack    | nothing to undo                                                                                                      | customers have no delete API, so the suite reuses `danwo-fidelity@example.com` and `danwo-fidelity-payments@example.com`; each run leaves one abandoned test transaction | none                                                                 |
| Flutterwave | nothing to undo                                                                                                      | each run leaves one test payment link, tagged by its reference                                                                                                           | none                                                                 |
| Bachs       | nothing to undo                                                                                                      | customers have no delete or list API; each run adds one sandbox customer with a tagged address                                                                           | none                                                                 |
| Resend      | nothing to undo                                                                                                      | sent emails cannot be deleted; they go only to `delivered@resend.dev`                                                                                                    | none                                                                 |
| Pusher      | nothing persists: triggered events and channels exist only while subscribed                                          | nothing                                                                                                                                                                  | none                                                                 |
| Twilio      | nothing: test credentials send nothing, and live ones only read and make sends Twilio refuses                        | nothing                                                                                                                                                                  | none                                                                 |
| Others      | Composio, Nylas, Nango, Unipile, Slack, GitHub, Google and Microsoft only read; the model APIs keep nothing          | nothing                                                                                                                                                                  | none                                                                 |
