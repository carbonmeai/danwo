# Integration lint

Every run is reviewed for risky provider usage from the calls and webhooks danwo already saw, with
no invariant to write.

## What it reads

`danwo test` and `danwo matrix` lint each attempt and trial once it ends: the calls the app made
through the proxy (method, host, path, status, headers by name, capped bodies, whether the browser
or the server sent them, and the kind of key they carried), the webhooks the app answered, and the
steps they happened in. Findings print after the run:

```text
integration lint: 2 errors, 1 warning
  error   secrets/key-in-browser  the browser sent a server-only key (sk_test_…) to POST api.stripe.com/v1/customers
          at tests/checkout.danwo.ts:9; Call the provider from your server with the secret key; …
```

They also go into the run's flight record (`## Integration lint` on the failure page and in the
HTML report), into GitHub check annotations at warning level, and into JUnit as a suite of their
own. A rule runs only when the run used a provider it is about, so it stays quiet otherwise.

Some rules need a fault to see anything: the webhook signature and freshness rules, and the
"trusted the redirect" rule, speak about `danwo matrix` trials that forged, aged or delayed a
delivery. Run the matrix on payment and webhook journeys to get them.

## Settings

```ts
export default defineConfig({
  lint: {
    rules: { "stripe/idempotency-key": "error", "resilience/no-retry-on-read": "off" },
    failOn: "error",
  },
})
```

Levels are `error`, `warn`, `info` and `off`. Findings never fail a run unless `failOn` is set
(`error`, or `warning` for warnings and worse). `--no-lint` skips the lint for one run, and
`lint: false` in the config turns it off. `danwo lint [run]` runs the current rules again over a
recorded run's flight records; record passing runs too with `--record always`.

## Rules

### webhooks-accepts-forged

The app answered 2xx to a webhook signed with the wrong secret. `danwo matrix` sends such a copy
when it plans a `forged` fault; an app that takes it does not check signatures, and anyone who
knows the URL can fake a payment. Verify the signature with the provider's signing secret first.

### payments-unconfirmed

The test passed after a hosted payment (Stripe Checkout, Paystack, Flutterwave or Bachs pages),
yet before its checks ended the app had neither verified the payment through the provider's API
nor taken a confirming webhook. It trusted the redirect back from the payment page, which anyone
can open. It shows in matrix trials that delay the webhook; fulfil from the webhook or verify on
the redirect.

### resilience-duplicate-create

A Stripe or Bachs create whose answer was lost (the provider did it, the connection dropped) was
sent again without the first call's `Idempotency-Key`, so the provider did it twice. Seen in matrix
trials with a `reset-after` fault. Reuse the key when you retry.

### secrets-key-in-browser

The browser sent a server-only key: a `sk_` secret key, a Flutterwave secret, a Slack or GitHub
token, or Twilio's Basic credentials. Anyone who opens the page can copy it. Danwo tells browser
requests from server ones by the headers browsers add to every request.

### secrets-key-in-url

A server-only key was sent in a query string, where server logs, proxies and history keep it.
Send keys in the `Authorization` header.

### stripe-idempotency-key

A Stripe call that creates or moves money (payment intents and their confirm and capture, Checkout
sessions, refunds, transfers, payouts, subscriptions, charges, invoice payments) went out without
an `Idempotency-Key`. Stripe's official libraries add one on their own; hand-written calls often do
not. Reported once per route.

### flutterwave-verify-transaction

The app gave value for a Flutterwave payment without calling `GET /v3/transactions/:id/verify`,
even if a webhook arrived; Flutterwave asks for the verify call and a check of status, amount and
currency. Danwo cannot see whether the app compared the amount and currency, only whether it
verified at all.

### webhooks-accepts-stale

The app accepted a delivery whose signature was made long ago, from a provider that signs a
timestamp (Stripe, Slack, Resend, Bachs, Google, Composio). Check the timestamp against a tolerance. Seen in
matrix trials with a `stale` fault; providers that sign no timestamp (GitHub, Twilio, Paystack,
Flutterwave) are not judged.

### webhooks-rejects-valid

The app answered a correctly signed delivery with a 4xx, which tells most providers never to retry,
or with a 5xx in a run with no fault anywhere. A 5xx while a fault is injected may be the app being
careful (it could not handle the delivery yet), so those are left alone.

### webhooks-slow-answer

The provider gave up waiting for the app's answer. Store the delivery, answer 2xx, then do the slow
work.

### resilience-retry-after-ignored

After a provider answered 429 with `Retry-After`, the app called the same route again before that
many seconds passed.

### oauth-missing-state

A sign-in (Google, Microsoft, GitHub, Slack) started without a `state` parameter, so the callback
cannot tell its own sign-in from a forged one.

### messages-duplicate-send

The same email, text or chat message (same endpoint, same body) was sent twice within one step.
Messages in different steps may rightly look alike, so only one step counts. A retry that sends
the first send's `Idempotency-Key` to the same endpoint is the same message (the provider answers
it with the first send) and is not counted.

### resilience-no-retry-on-read

A provider read failed with 429, 503 or a dropped connection and was not tried again. Informational:
some apps rightly show an error instead.

### oauth-missing-pkce

A Google, Microsoft or GitHub sign-in started without PKCE. Informational for server-side apps,
which also hold a client secret.

### secrets-publishable-on-server

The app's server called a provider with a publishable key. Informational.

### data-no-retry-on-serialization

A Postgres statement through a data proxy (see `danwo guide infrastructure`) failed with
`serialization_failure` (40001) or `deadlock_detected` (40P01), and no later BEGIN or the same
statement followed: the transaction was given up rather than run again, which is what Postgres
asks for with these two errors.

## What it does not check

Whether an id token was checked against the provider's keys (a fetch of the keys proves little,
since libraries cache them), and whether the app compared a payment's amount and currency (danwo
sees the verify call, not the comparison).
