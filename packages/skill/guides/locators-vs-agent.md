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

The agent needs a `model` in the config. A model id such as `"anthropic/claude-sonnet-5"` goes
through the Vercel AI Gateway with `AI_GATEWAY_API_KEY` from the environment: export it, or have
your test command load a `.env`, since danwo reads no `.env` of its own. Every verified step is
recorded under `cache.dir`;
the next run replays it with no model call, finding each element again by what it was. A step
whose page changed is handed back to the model and recorded afresh (`danwo guide debugging`
explains the cache outcomes).

Every kind of agent step replays:

- `act`: its actions, found again by what each element was; a replay must also have the step's
  recorded effects on the page and behind it (a provider call made by background work is waited
  for up to 10 s).
- `assert` and `waitFor`: the judge names a short text on the page that shows the claim holds; a
  replay waits for that text. A claim with no such text (something is absent) asks the judge each
  run.
- `extract`: the elements each value was read from. For how many of something the page lists
  when no text says the number, the model reads `as: "count"` by pointing at one item; a replay
  counts the shown elements with its test id, or its role.

A step whose recording no longer matches is re-asked (`handed-off`), and its record says why: an
element no longer on the page or matching several, an effect that did not happen, evidence not
shown. Read that reason before rewriting the step; a reason that names an app change means the
replay caught it.

Values in braces come from `params`: `unique(...)` gives a fresh value each run that replays still
accept, `secret(name)` keeps the value from the model, and values the agent reads from mail are
recorded by where they came from, not as text.

## Choosing

- Exact, stable controls (a Pay button, a total): locators.
- Multi-step flows through third-party pages, or UI that changes often: `agent.act`.
- Claims about what the page means ("the order is confirmed"): `agent.assert`, polled with
  `{ poll: true }` when the page gets there in its own time.
- Numbers you then compare with the backend: `agent.extract`.

## What only an image shows

Some of a page is not in the text the agent reads: a canvas or chart, an icon button with no name,
a widget in a frame the view cannot list. With `vision` on (`auto` by default) the agent is told
when a page has such parts and can `look` at a screenshot with numbered marks, then click, type,
drag or scroll at a mark or at coordinates. Those actions replay with no model call: each place is
found again by how it looks, at the same spot of the same element, and searched for when it moved
(never under strict replay). A changed picture hands the step back to the model, or diverges under
strict replay. `agent.assert` and `agent.extract` see a screenshot the same way, and
`act(..., { vision: false })` keeps a step to the text view. Forms inside frames, even from another
origin, need no image: the agent reaches them through the text view and replays them by frame.
