# Emulating a provider

danwo runs fake Stripe, Resend, S3 and Tigris, Google, Microsoft, Slack, GitHub and Twilio behind
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
`s3Environment`, `googleEnvironment`, `microsoftEnvironment`, `slackEnvironment`,
`githubEnvironment`, `awsEnvironment` (MiniStack for other AWS services).

## Reading what happened

Type the fixtures with `test.extend<StripeFixtures>()` and read the emulators in tests and
invariants: `resendInbox`, `s3Objects`, `gmailMailbox`, `googleCalendar`, `googleDrive`,
`outlookMailbox`, `outlookCalendar`, `oneDrive`, `graphSubscriptions`, `slackWorkspace`,
`githubRepo`, `twilioInbox` (and `twilioPhone` to text the app), and the `*SignIns` helpers. `danwo spec --topic emulators` lists them with their
signatures, and `--topic environments` the seed shapes.
