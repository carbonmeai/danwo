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

| Provider                  | Scenarios                                                                                                                                                                                                                                                                                                                                                          | Live run reads                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe                    | customers, paging, errors, idempotency, products and prices, payment intent and refund, checkout session, events                                                                                                                                                                                                                                                   | `DANWO_FIDELITY_STRIPE_KEY` (`sk_test_` or `rk_test_`)                                                                                                                                                                                                                                         |
| Resend                    | send and read back, batch, idempotent send, errors, domains                                                                                                                                                                                                                                                                                                        | `DANWO_FIDELITY_RESEND_KEY`; sends only to `delivered@resend.dev`                                                                                                                                                                                                                              |
| S3 (Tigris)               | objects with checksums, ranges, copies and delete-many; listings with prefixes, delimiters and pages; multipart parts, listings, complete and abort, and lib-storage; presigned and expired URLs; conditional reads and writes; errors (missing key and bucket, bad range, wrong secret, unknown key, unsigned, malformed body); Tigris's presign call and renames | `DANWO_FIDELITY_TIGRIS_ACCESS_KEY_ID`, `DANWO_FIDELITY_TIGRIS_SECRET_ACCESS_KEY`, `DANWO_FIDELITY_TIGRIS_BUCKET` (an empty test bucket the key is scoped to); optional `DANWO_FIDELITY_TIGRIS_ENDPOINT` (default `https://t3.storage.dev`) and `DANWO_FIDELITY_TIGRIS_REGION` (default `auto`) |
| Twilio                    | test credentials: send from the magic test number, invalid recipient and unowned sender; live credentials: the account, its numbers and messages, bad credentials, a missing message, no recipient, and a trial or full account's refused sends; with the account's number and a recipient, one real send followed until it settles                                | `DANWO_FIDELITY_TWILIO_ACCOUNT_SID`, plus an API key (`DANWO_FIDELITY_TWILIO_API_KEY_SID`, `_API_KEY_SECRET`, preferred) or `DANWO_FIDELITY_TWILIO_AUTH_TOKEN`; for a real send `DANWO_FIDELITY_TWILIO_FROM` and `_TO` (and `_SEND_ON_TRIAL=1` on a trial account)                             |
| Paystack                  | initialize and verify, customers, banks, errors                                                                                                                                                                                                                                                                                                                    | `DANWO_FIDELITY_PAYSTACK_KEY` (`sk_test_`)                                                                                                                                                                                                                                                     |
| Flutterwave               | hosted payment link, banks, key errors                                                                                                                                                                                                                                                                                                                             | `DANWO_FIDELITY_FLUTTERWAVE_KEY` (`FLWSECK_TEST-`)                                                                                                                                                                                                                                             |
| Bachs                     | customers, errors                                                                                                                                                                                                                                                                                                                                                  | `DANWO_FIDELITY_BACHS_KEY` (`sk_sandbox_`)                                                                                                                                                                                                                                                     |
| Slack, GitHub             | public calls: `api.test` and token errors, a public repository and a 404                                                                                                                                                                                                                                                                                           | `DANWO_FIDELITY_PUBLIC=1`, plus an optional `DANWO_FIDELITY_GITHUB_TOKEN`                                                                                                                                                                                                                      |
| Google                    | sign-in discovery and signing keys; with a signed-in test account, Gmail labels, a message sent to itself (read, relabelled, trashed), Calendar events and the calendar list, Drive files uploaded, read and deleted, and the errors                                                                                                                               | `DANWO_FIDELITY_PUBLIC=1` for the public calls; for the account `DANWO_FIDELITY_GOOGLE_CLIENT_ID`, `_CLIENT_SECRET` and `_REFRESH_TOKEN` (from `danwo fidelity login google`)                                                                                                                  |
| Microsoft                 | sign-in discovery and signing keys; with a signed-in test account, `/me`, mail folders, a message sent to itself (read, patched, deleted), events, a OneDrive file, the change subscriptions, and the errors                                                                                                                                                       | `DANWO_FIDELITY_PUBLIC=1` for the public calls; for the account `DANWO_FIDELITY_MICROSOFT_CLIENT_ID`, `_CLIENT_SECRET`, `_REFRESH_TOKEN` (from `danwo fidelity login microsoft`) and optional `_TENANT_ID` (default `common`)                                                                  |
| Composio                  | key errors live; with a key, a toolkit, a tool, a trigger type, auth configs and connected accounts (reads only)                                                                                                                                                                                                                                                   | `DANWO_FIDELITY_PUBLIC=1`; optional `DANWO_FIDELITY_COMPOSIO_KEY` (a test project's `ak_` key)                                                                                                                                                                                                 |
| Pusher                    | triggers, a batch, one channel, the occupied channels and presence user counts; subscription counts with counting on, and the refusals with it off; with a Beams instance, publishes to an interest and a user no device has, and its refusals                                                                                                                     | `DANWO_FIDELITY_PUSHER_APP_ID`, `_KEY`, `_SECRET`, `_CLUSTER` (a test app); optional `DANWO_FIDELITY_PUSHER_BEAM_INSTANCE_ID`, `_BEAM_SECRET_KEY`                                                                                                                                              |
| Novu                      | key error live; with a key, a subscriber created, read, patched and deleted                                                                                                                                                                                                                                                                                        | `DANWO_FIDELITY_PUBLIC=1`; optional `DANWO_FIDELITY_NOVU_KEY` (a development environment)                                                                                                                                                                                                      |
| Tiptap                    | a document created from JSON, read as JSON, deleted, then missing                                                                                                                                                                                                                                                                                                  | `DANWO_FIDELITY_TIPTAP_APP_ID`, `DANWO_FIDELITY_TIPTAP_API_SECRET`, optional `DANWO_FIDELITY_TIPTAP_DOC_PREFIX`                                                                                                                                                                                |
| Clerk                     | users, organizations with members and invitations, sessions and tokens, signing keys, errors; the browser's sign-up and sign-in by emailed code, and the session token it ends in                                                                                                                                                                                  | `DANWO_FIDELITY_CLERK_SECRET_KEY` (`sk_test_`) and `DANWO_FIDELITY_CLERK_PUBLISHABLE_KEY` (`pk_test_`) of a development instance                                                                                                                                                               |
| AI Gateway (`gateway`)    | language model text, tool call, structured output, stream events, embedding, errors (unknown model, no key, malformed prompt)                                                                                                                                                                                                                                      | `DANWO_FIDELITY_AI_GATEWAY_KEY`, else `AI_GATEWAY_API_KEY`                                                                                                                                                                                                                                     |
| Gemini (`gemini`)         | text, function call, structured output, stream events, token counting, embeddings, no key                                                                                                                                                                                                                                                                          | `DANWO_FIDELITY_GEMINI_KEY` (a Google AI Studio key)                                                                                                                                                                                                                                           |
| Perplexity (`perplexity`) | Agent API text, function call, structured output, stream events; Sonar with citations; no key                                                                                                                                                                                                                                                                      | `DANWO_FIDELITY_PERPLEXITY_KEY`                                                                                                                                                                                                                                                                |
| Nylas                     | key errors; with a key, the application's grants listed and one read (reads only)                                                                                                                                                                                                                                                                                  | `DANWO_FIDELITY_PUBLIC=1`; optional `DANWO_FIDELITY_NYLAS_KEY`                                                                                                                                                                                                                                 |
| Nango                     | key errors; with a key, the project's integrations and connections (reads only)                                                                                                                                                                                                                                                                                    | `DANWO_FIDELITY_PUBLIC=1`; optional `DANWO_FIDELITY_NANGO_KEY` (a development environment)                                                                                                                                                                                                     |
| Unipile                   | an unknown token; with a key, the connected accounts (reads only)                                                                                                                                                                                                                                                                                                  | `DANWO_FIDELITY_UNIPILE_DSN`, `DANWO_FIDELITY_UNIPILE_KEY`                                                                                                                                                                                                                                     |
| Bedrock (`bedrock`)       | Converse text and tool call, InvokeModel with Nova's body, unsigned call                                                                                                                                                                                                                                                                                           | `DANWO_FIDELITY_BEDROCK_API_KEY` (a Bedrock API key), optional `DANWO_FIDELITY_BEDROCK_REGION`                                                                                                                                                                                                 |

Keys come from the environment, or from `.env.fidelity` and then `.env` at the repository root,
which git ignores; neither file has to exist. The files are read as dotenv reads them: `export`
before a name is fine, a comment after an unquoted value (`KEY=value # note`) is not part of it,
and a quoted value keeps everything inside its quotes. The gateway suite drives the AI SDK's own gateway provider, so each request is
the one an app sends; it uses the cheapest models and 20 output tokens, so a live run costs a small
fraction of a cent, which the gateway reports in each answer's cost metadata.

## Google and Microsoft test accounts

The Gmail, Calendar, Drive and Microsoft Graph suites act as one signed-in test account. Offline,
the emulator plays that account. The goldens come from Google's Discovery documents (Gmail v1,
Calendar v3, Drive v3) and Microsoft Graph's OpenAPI description (v1.0, only the paths the suites
call), so `--from-openapi` rebuilds them from what the providers publish. Live, the suites need an
OAuth client and a refresh token for the account; without them those scenarios skip with a pointer
to the login.

```sh
danwo fidelity login google       # opens the consent page, keeps the refresh token
danwo fidelity login microsoft
danwo fidelity login google --port 9000   # default redirect: http://127.0.0.1:8765/callback
danwo fidelity login google --redirect-uri http://localhost:3050/settings/integrations/google-verify
danwo fidelity google microsoft   # the live run, once signed in
```

The login reads the client from `.env.fidelity`, listens for the redirect on this machine, sends
the browser to the provider's consent page with PKCE and a checked `state`, and writes only the
refresh token (`DANWO_FIDELITY_GOOGLE_REFRESH_TOKEN` or `DANWO_FIDELITY_MICROSOFT_REFRESH_TOKEN`)
back to `.env.fidelity`, keeping every other line and comment and the file's mode `600`. It never
prints the token; it prints the account's address and the scopes granted. It shows the scopes
before the browser opens, and waits five minutes for the redirect.

| Provider  | Scopes asked for                                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google    | `openid`, `email`, `gmail.modify`, `calendar.events`, `calendar.calendarlist.readonly`, `drive.file` (only files the suite made); with `access_type=offline&prompt=consent` for a refresh token |
| Microsoft | `openid`, `email`, `offline_access`, `User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `Files.ReadWrite`                                                                       |

Gmail's permanent delete needs the full `https://mail.google.com/` scope, so the suite moves its
messages to the trash instead, where Gmail empties them after 30 days.

### A Google client

1. In the Google Cloud Console, make or pick a project for testing, and enable the Gmail, Google
   Calendar and Google Drive APIs.
2. Under **Google Auth Platform → Audience**, keep the app in **Testing** and add the test account
   as a test user. Refresh tokens of an app in Testing expire after seven days; run the login
   again when a live run says the token was refused.
3. Under **Data access**, add the scopes above.
4. Under **Clients**, create a **Web application** client with the authorized redirect URI
   `http://127.0.0.1:8765/callback` (or the one you pass with `--redirect-uri`).
5. Put its id and secret in `.env.fidelity`:

```sh
DANWO_FIDELITY_GOOGLE_CLIENT_ID=....apps.googleusercontent.com
DANWO_FIDELITY_GOOGLE_CLIENT_SECRET=...
```

### A Microsoft client

1. In the Azure portal, **Microsoft Entra ID → App registrations → New registration**. For a
   personal test account choose **Accounts in any organizational directory and personal Microsoft
   accounts**.
2. Add a **Web** platform redirect URI that matches what the login uses, such as
   `http://127.0.0.1:8765/callback`.
3. Under **Certificates & secrets**, create a client secret and copy its value (not its id).
4. Under **API permissions**, add the delegated Microsoft Graph permissions above.
5. Put them in `.env.fidelity`. The tenant is `common` unless set: `consumers` for personal
   accounts only, or a tenant id.

```sh
DANWO_FIDELITY_MICROSOFT_CLIENT_ID=...
DANWO_FIDELITY_MICROSOFT_CLIENT_SECRET=...
DANWO_FIDELITY_MICROSOFT_TENANT_ID=common
```

### Reuse your app's OAuth client

An app that already signs people in to Google or Microsoft has a client with its own redirect
URIs, usually on its dev server. The login can use that client and one of those URIs instead of a
new registration: set `DANWO_FIDELITY_GOOGLE_REDIRECT_URI` or
`DANWO_FIDELITY_MICROSOFT_REDIRECT_URI` in `.env.fidelity` (or pass `--redirect-uri`), and danwo
listens on that URI's host, port and path.

```sh
DANWO_FIDELITY_GOOGLE_REDIRECT_URI=http://localhost:3050/settings/integrations/google-verify
DANWO_FIDELITY_MICROSOFT_REDIRECT_URI=http://localhost:3050/settings/integrations/microsoft-verify
```

- Stop the app's dev server first: the login needs its port, and says "stop the app on :3050
  first" when the port is busy.
- The URI must be `http` on `localhost`, `127.0.0.1` or `[::1]`. For `localhost` danwo listens on
  both `127.0.0.1` and `::1`, whichever the browser picks.
- The client must allow the scopes above; add any it lacks under its data access or API
  permissions.
- Sign in with a test account, not the one you use for the app.

### What the login says

| Message                                                        | Means                                                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| set `…_CLIENT_ID` and `…_CLIENT_SECRET` in .env.fidelity first | the client is not in `.env.fidelity`                                                                              |
| the token endpoint refused the redirect URI                    | register exactly the URI it names on the client, or pass the registered one with `--redirect-uri`                 |
| no answer from the consent page after 300 s                    | the browser never came back; a `redirect_uri_mismatch` page means the URI is not registered                       |
| the sign-in was cancelled on the consent page                  | **Cancel** was chosen; run it again                                                                               |
| the redirect's state does not match this sign-in               | the redirect was not this sign-in's; run it again                                                                 |
| … gave no refresh token                                        | the account had granted the client before; remove its access in the account's security settings and sign in again |
| port N on host is in use                                       | another process holds the redirect port: stop it, or use `--port`                                                 |

### Live runs as the account

- Everything a run makes is tagged `danwo-fidelity-<run>`: label, event and file names, and mail
  subjects. Mail is sent only to the account's own address.
- Each create goes through the cleanup ledger: labels, events and files are deleted, Gmail messages
  trashed, Outlook messages permanently deleted (the sent and the received copy).
- The suites never touch anything untagged. `danwo fidelity --sweep google microsoft` lists tagged
  leftovers, and removes them with `--yes`.
- Before its first request a live run reads which account the token belongs to. An address that
  does not look personal (`@gmail.com`, `@googlemail.com`; `@outlook.com`, `@hotmail.com`,
  `@live.com`, `@msn.com`) is refused with `CONFIG_INVALID`, so a work or school account is never
  written to by mistake. To run as such an account on purpose, name it:
  `DANWO_FIDELITY_GOOGLE_ACCOUNT=qa@example.com` or `DANWO_FIDELITY_MICROSOFT_ACCOUNT=…`.

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
  has not verified); a full account with `21211` and `21606`.
- A real Twilio send runs only when the account's own number and a recipient are set
  (`DANWO_FIDELITY_TWILIO_FROM`, `DANWO_FIDELITY_TWILIO_TO`), and sends one message per run: it
  follows the message until it settles, reads and lists it, then deletes it. A trial account
  differs in three ways the emulator follows too: it can only send a predefined template (its
  `Body` names one, such as `sms_internal_alerts`, and the message carries the template's text;
  any other body is refused with `572006`), its messages carry no price unit, and it can neither
  delete nor redact them (`401`, `20003`). So on a trial account the send runs only with
  `DANWO_FIDELITY_TWILIO_SEND_ON_TRIAL=1`, and the message it leaves in the account's log is
  reported as kept by the provider rather than failing the run. Without the numbers, a successful
  send's shape is checked against the published API reference only, unless test credentials are
  set.
- Flutterwave's banks list has answered every country with its generic `400` ("An error
  occurred") in test mode while other reads with the same key work; the live run then skips that
  scenario as a provider error, and the emulator is still checked offline against the golden.
- Pusher's subscription counts depend on an app setting, **Enable subscription counting**, which
  is off on a new app. The suite asks the real app once which way it is set: with counting on it
  checks the counts, with it off the 400s Pusher answers instead, and it skips the other scenario.
  The emulator follows the same setting (`subscriptionCounting` on a seeded app, off by default).
- Tiptap documents are named `<DANWO_FIDELITY_TIPTAP_DOC_PREFIX><tag>`, so a shared app can keep
  the suite's documents apart from its own.
- S3 runs go to Tigris with a key scoped to one empty test bucket, and never create or delete a
  bucket. Every object they write is under `danwo-fidelity/<run>/`, and after each scenario,
  finished or not, every object under that prefix is deleted and every multipart upload under it
  aborted. The calls are the official AWS SDK's (`@aws-sdk/client-s3`, `lib-storage`,
  `s3-request-presigner`); each answer is compared as its headers that SDKs read and its XML as
  JSON. The Tigris SDK's own call (`POST /?func=presign`) and renames (`X-Tigris-Rename`) are in
  the suite too, since they are not plain S3.
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
references, Bachs addresses, Pusher channels, Resend subjects, and Gmail, Calendar, Drive, Outlook and OneDrive names and
subjects.

Each create registers its undo with the run's cleanup ledger, by provider, kind and id. After every
scenario, whether it passed, failed or threw, the ledger undoes in reverse order, retrying each undo
once; a 404, a 410 or an answer that says the object is already gone or final counts as undone.
Ctrl-C undoes what the open scenarios made before the process exits. Whatever could not be undone
is printed per provider under "left behind", by kind and id (never a secret), and in the closing
line, and fails the run. `--keep` leaves everything in place on purpose and lists it as kept.

`danwo fidelity --sweep [providers]` lists what earlier runs left in the sandboxes. It only ever
removes resources carrying the tag, and only with `--yes`; look-alikes from before tagging are
listed for you to judge and never touched.

| Provider    | Undone after each scenario                                                                                                                  | Cannot be removed                                                                                                                                                        | Sweep                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Stripe      | customers deleted, subscriptions and setup intents canceled, products and prices archived, Checkout Sessions expired                        | payment intents, refunds and expired sessions stay in the test-mode history; products Stripe makes for inline line items cannot be archived                              | tagged customers deleted, tagged products archived with their prices |
| Clerk       | users and organizations deleted, invitations and sessions revoked                                                                           | nothing                                                                                                                                                                  | tagged users and organizations deleted                               |
| Novu        | subscribers deleted                                                                                                                         | nothing                                                                                                                                                                  | tagged subscribers deleted                                           |
| Tiptap      | documents deleted                                                                                                                           | nothing                                                                                                                                                                  | prefixed, tagged documents deleted                                   |
| Paystack    | nothing to undo                                                                                                                             | customers have no delete API, so the suite reuses `danwo-fidelity@example.com` and `danwo-fidelity-payments@example.com`; each run leaves one abandoned test transaction | none                                                                 |
| Flutterwave | nothing to undo                                                                                                                             | each run leaves one test payment link, tagged by its reference                                                                                                           | none                                                                 |
| Bachs       | nothing to undo                                                                                                                             | customers have no delete or list API; each run adds one sandbox customer with a tagged address                                                                           | none                                                                 |
| Resend      | nothing to undo                                                                                                                             | sent emails cannot be deleted; they go only to `delivered@resend.dev`                                                                                                    | none                                                                 |
| Pusher      | nothing persists: triggered events and channels exist only while subscribed, and Beams publishes go to an interest and a user no device has | nothing                                                                                                                                                                  | none                                                                 |
| Twilio      | the one message a full account sends, deleted once it settles; otherwise nothing is made                                                    | the message a trial account sends (only with `DANWO_FIDELITY_TWILIO_SEND_ON_TRIAL=1`): trial accounts cannot delete or redact messages                                   | none                                                                 |
| Google      | labels, events and Drive files deleted; messages trashed                                                                                    | trashed messages stay in the trash until Gmail empties it after 30 days                                                                                                  | tagged labels, events and files deleted, tagged messages trashed     |
| Microsoft   | messages permanently deleted, events and OneDrive files deleted                                                                             | deleted OneDrive files sit in the recycle bin until it is emptied                                                                                                        | tagged messages, events and root files deleted                       |
| Others      | Composio, Nylas, Nango, Unipile, Slack and GitHub only read; the model APIs keep nothing                                                    | nothing                                                                                                                                                                  | none                                                                 |
