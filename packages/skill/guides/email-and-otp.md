# Email codes, magic links and 2FA

Sign-up and sign-in flows that go through mail or an authenticator replay without a model when
the values come from the emulators instead of from the screen.

## Where mail lands

Return the mail sources from the environment, e.g. `mail: [resendMail(resend)]` (also
`gmailMail(google)` and `outlookMail(microsoft)`). Tests then get a `mail` fixture:

```ts
await screen.getByLabel("Email").fill(email)
await screen.getByRole("button", { name: "Send code" }).click()
await screen.getByLabel("Code").fill(await mail.code(email))
// or a magic link
await app.open(await mail.link(email, { match: "Sign in" }))
// or look at the email itself and click in it
await mail.open(email)
```

`code` and `link` wait for the email when it has not arrived yet.

## With the agent

The agent has mail tools of its own: it reads a code or link from the newest email to an address,
or opens the email in the tab. A recording keeps where the value came from (the newest email to
the `email` param), never the value, so a replay with a fresh `unique(...)` address reads the new
code and needs no model:

```ts
await agent.act("sign up as {email} and confirm with the emailed code", {
  params: { email: unique("ada@shop.test") },
})
```

## Authenticator codes

Configure a secret with purpose `totp` whose value is the base32 key the app showed at enrolment:

```ts
secrets: { otpKey: { value: process.env.TOTP_KEY ?? "", purpose: "totp" } }
```

`fill(secret("otpKey"))` (or the agent's `fill_secret`) types the code for that moment; the key
and the codes are redacted everywhere. `totp(key)` computes a code directly when a test needs it.
