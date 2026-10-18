# Locators or the agent

Use locators for steps you can name exactly; use the agent for steps that are easier to say than
to pin down. Both can live in one test.

## Locators

`screen.getByRole("button", { name: "Pay" })`, `getByLabel`, `getByText`, `getByPlaceholder`,
`getByDisplayValue` and `getByTestId` find elements the way a user names them. A string matches as
a case-insensitive substring unless you pass `{ exact: true }`; a RegExp tests the whole name.
Actions (`click`, `fill`, `press`, `check`, `selectOption`, `hover`, `setInputFiles`, `dragTo`)
need exactly one match and wait for the element to be ready. Narrow with `.first()`, `.nth(i)`,
`.filter({ hasText })` or by chaining another `getBy…`.

Prefer, in order: role with a name, label, text, test id. Check a locator against the live app
before writing it: the MCP tool `check_locator` returns the exact line to paste.

## The agent

```ts
await agent.act("sign in as {email} with password {password}", {
  params: { email: unique("ada@shop.test"), password: secret("password") },
})
await agent.assert("the dashboard greets Ada")
const { balance } = await agent.extract("the account balance", z.object({ balance: z.number() }))
await agent.waitFor("the order shows as paid")
```

The agent needs a `model` in the config. Every verified step is recorded under `cache.dir`;
the next run replays it with no model call, finding each element again by what it was. A step
whose page changed is handed back to the model and recorded afresh (`danwo guide debugging`
explains the cache outcomes).

Values in braces come from `params`: `unique(...)` gives a fresh value each run that replays still
accept, `secret(name)` keeps the value from the model, and values the agent reads from mail are
recorded by where they came from, not as text.

## Choosing

- Exact, stable controls (a Pay button, a total): locators.
- Multi-step flows through third-party pages, or UI that changes often: `agent.act`.
- Claims about what the page means ("the order is confirmed"): `agent.assert`, polled with
  `{ poll: true }` when the page gets there in its own time.
- Numbers you then compare with the backend: `agent.extract`.
