# Emulating a provider

danwo runs fake Stripe, Resend, S3 and Tigris, Auth0, Google, Microsoft, Slack, GitHub and Twilio behind
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

## Several providers

`startServices([stripeService({ seed }), s3Service(), slackService({ seed }), githubService()])`
composes services behind one proxy; its result has `fixtures`, `webhooks` (keyed by service),
`settle`, `reset` and `close` merged. Single-provider shortcuts: `stripeEnvironment`,
`s3Environment`, `auth0Environment`, `googleEnvironment`, `microsoftEnvironment`, `slackEnvironment`,
`githubEnvironment`, `awsEnvironment` (MiniStack for other AWS services).

## Reading what happened

Type the fixtures with `test.extend<StripeFixtures>()` and read the emulators in tests and
invariants: `resendInbox`, `s3Objects`, `auth0Tenant`, `gmailMailbox`, `googleCalendar`, `googleDrive`,
`outlookMailbox`, `outlookCalendar`, `oneDrive`, `graphSubscriptions`, `slackWorkspace`,
`githubRepo`, `twilioInbox` (and `twilioPhone` to text the app), and the `*SignIns` helpers. `danwo spec --topic emulators` lists them with their
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
