# Emulating a provider

danwo runs fake Stripe, Resend, S3 and Tigris, Auth0, Google, Microsoft, Slack, GitHub, Twilio and Composio behind
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

danwo leaves nothing running. The app's command runs as the leader of its own process group, so
stopping it stops what it started too (a dev command often runs the server as its own child): it gets
SIGTERM, then SIGKILL five seconds later. The same happens when a run ends, fails, is interrupted
(Ctrl-C, SIGTERM, SIGHUP) or is killed outright, since a small guardian process ends whatever a
worker owned once the worker is gone. Have the app exit on SIGTERM. An environment that starts
its own processes should start them with `spawnOwned()` from `@danwo/sdk`, which takes the same
arguments as `spawn()` and returns the child with a `stop()`.

## Several providers

`startServices([stripeService({ seed }), s3Service(), slackService({ seed }), githubService()])`
composes services behind one proxy; its result has `fixtures`, `webhooks` (keyed by service),
`settle`, `reset` and `close` merged. Single-provider shortcuts: `stripeEnvironment`,
`s3Environment`, `auth0Environment`, `googleEnvironment`, `microsoftEnvironment`, `slackEnvironment`,
`githubEnvironment`, `composioEnvironment`, `awsEnvironment` (MiniStack for other AWS services).

## Reading what happened

Type the fixtures with `test.extend<StripeFixtures>()` and read the emulators in tests and
invariants: `resendInbox`, `s3Objects`, `auth0Tenant`, `gmailMailbox`, `googleCalendar`, `googleDrive`,
`outlookMailbox`, `outlookCalendar`, `oneDrive`, `graphSubscriptions`, `slackWorkspace`,
`githubRepo`, `twilioInbox` (and `twilioPhone` to text the app), `composioProject`, and the `*SignIns` helpers. `danwo spec --topic emulators` lists them with their
signatures, and `--topic environments` the seed shapes.

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
return `mail: [clerkMail(clerk.emulator)]` from the environment so `mail.code(email)` reads the
codes. Session tokens are RS256 JWTs with Clerk's claims, valid 60 seconds.

In tests, `clerkInstance(clerk)` reads users, sessions and codes, and
`revokeSessions(email)` signs a user out everywhere mid-test: the next token refresh is refused
and the next handshake signs the app out. `danwo matrix` faults the Backend API (429 with
`Retry-After`, 500, 503, a slow answer, resets), the signing keys and handshake payloads (500,
reset) and ClerkJS's token refresh (500, 503). Recordings redact `sk_test_` keys, session
tokens, Clerk cookies, dev browser tokens and handshake nonces.

Not emulated: social and enterprise sign-in, phone codes, passkeys, MFA, waitlists, billing and
Clerk's webhooks.

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
