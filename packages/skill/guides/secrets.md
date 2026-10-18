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
private keys. Screenshots mask fields that hold a secret.
