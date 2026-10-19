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
```

Without credentials it checks the emulator against `fidelity/<provider>.json`. That offline check
runs in `bun run check`, so an emulator change that breaks fidelity fails without any keys. Each
difference prints with its scenario and step, classified as a missing field, an extra field, a type
mismatch, a status mismatch, an error-code mismatch, an ordering difference or a missing step.

## Suites

| Provider                         | Scenarios                                                                                                                                                                         | Live run reads                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Stripe                           | customers, paging, errors, idempotency, products and prices, payment intent and refund, checkout session, events                                                                  | `DANWO_FIDELITY_STRIPE_KEY` (`sk_test_` or `rk_test_`)                                                                           |
| Resend                           | send and read back, batch, idempotent send, errors, domains                                                                                                                       | `DANWO_FIDELITY_RESEND_KEY`; sends only to `delivered@resend.dev`                                                                |
| Twilio                           | send from the magic test number, invalid recipient and unowned sender                                                                                                             | `DANWO_FIDELITY_TWILIO_ACCOUNT_SID`, `DANWO_FIDELITY_TWILIO_AUTH_TOKEN` (test credentials)                                       |
| Paystack                         | initialize and verify, customers, banks, errors                                                                                                                                   | `DANWO_FIDELITY_PAYSTACK_KEY` (`sk_test_`)                                                                                       |
| Flutterwave                      | hosted payment link, banks, key errors                                                                                                                                            | `DANWO_FIDELITY_FLUTTERWAVE_KEY` (`FLWSECK_TEST-`)                                                                               |
| Bachs                            | customers, errors                                                                                                                                                                 | `DANWO_FIDELITY_BACHS_KEY` (`sk_sandbox_`)                                                                                       |
| Slack, GitHub, Google, Microsoft | public calls: `api.test` and token errors, a public repository and a 404, sign-in discovery and signing keys                                                                      | `DANWO_FIDELITY_PUBLIC=1`, plus an optional `DANWO_FIDELITY_GITHUB_TOKEN`                                                        |
| Composio                         | key errors live; with a key, a toolkit, a tool, a trigger type, auth configs and connected accounts (reads only)                                                                  | `DANWO_FIDELITY_PUBLIC=1`; optional `DANWO_FIDELITY_COMPOSIO_KEY` (a test project's `ak_` key)                                   |
| Clerk                            | users, organizations with members and invitations, sessions and tokens, signing keys, errors; the browser's sign-up and sign-in by emailed code, and the session token it ends in | `DANWO_FIDELITY_CLERK_SECRET_KEY` (`sk_test_`) and `DANWO_FIDELITY_CLERK_PUBLISHABLE_KEY` (`pk_test_`) of a development instance |
| AI Gateway (`gateway`)           | language model text, tool call, structured output, stream events, embedding, errors (unknown model, no key, malformed prompt)                                                     | `DANWO_FIDELITY_AI_GATEWAY_KEY`, else `AI_GATEWAY_API_KEY`                                                                       |
| Gemini (`gemini`)                | text, function call, structured output, stream events, token counting, embeddings, no key                                                                                         | `DANWO_FIDELITY_GEMINI_KEY` (a Google AI Studio key)                                                                             |
| Perplexity (`perplexity`)        | Agent API text, function call, structured output, stream events; Sonar with citations; no key                                                                                     | `DANWO_FIDELITY_PERPLEXITY_KEY`                                                                                                  |
| Bedrock (`bedrock`)              | Converse text and tool call, InvokeModel with Nova's body, unsigned call                                                                                                          | `DANWO_FIDELITY_BEDROCK_API_KEY` (a Bedrock API key), optional `DANWO_FIDELITY_BEDROCK_REGION`                                   |

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
- Scenarios clean up what they create, and each makes a handful of requests.
- Twilio runs use magic numbers: with real credentials the sender is not owned, so nothing sends.
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
