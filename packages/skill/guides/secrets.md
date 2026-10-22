# Secrets

Passwords, keys and codes are configured by name; tests and the agent use the name, and the value
never reaches the model, a recording or a report.

```ts
// danwo.config.ts
secrets: {
  password: { value: process.env.APP_PASSWORD ?? "", purpose: "password" },
  apiKey: process.env.APP_API_KEY ?? "",           // a plain value is a generic secret
  otpKey: { value: process.env.TOTP_KEY ?? "", purpose: "totp" },
}
```

In a test: `screen.getByLabel("Password").fill(secret("password"))`, or pass it to the agent as a
param: `agent.act("sign in with {password}", { params: { password: secret("password") } })`.
The agent only sees the name; replays fill the value again.

## Where a secret may go

A secret only goes into a field its purpose allows, and is refused with `SECRET_REFUSED`
otherwise:

- `password`: password inputs;
- `otp` and `totp`: one-time-code and text inputs;
- `generic-secret` (the default): any field except a password input.

`fields: ["text", "other"]` or `fields: "any"` overrides that for one secret.

## Redaction

Flight records, failure pages, MCP answers and the GitHub check redact every configured value,
including its URL-encoded, form-encoded, HTML-escaped, base64 and other-case forms, and anything
shaped like a credential: provider keys, bearer tokens, webhook signing secrets, OAuth tokens,
private keys. Screenshots mask fields that hold a secret. Text cut to length (the agent's page view,
a failed locator's candidates, a check's previewed sides) is redacted before the cut, and every
string of a record gets a last pass when it is written, so a function-valued secret revealed late
is caught in what was recorded before it. A test's error, where its body stopped and its replay
divergence are redacted with every value the session knew at its end before they leave the
attempt, so the terminal, `results.json`, JUnit, the run history, custom reporters, the PR comment
and the job summary never hold one. The environment record's startup output (written before any
test) is redacted with the config's own `secrets` values and credential shapes; a function-valued
secret is not known there until a test reveals it. danwo keeps no browser downloads, so there is
nothing of them to scan.
