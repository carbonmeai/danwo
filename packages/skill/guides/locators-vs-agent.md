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
replay caught it. A step the model took over from a replay keeps the actions the replay had
already done in its new recording.

A step's recorded page effects leave out text that changes between runs: times and dates,
relative times (`7 sec. ago`, `a minute ago`, `in 3 days`), month dates (`Oct 20`), am/pm times
(`3pm`), durations (`321ms`, `1.2s`), result counts and ranges (`Showing 1 to 9 of 9 results`,
`3 records imported`) and badges that are only a number (`11`, `99+`), so a replay does not wait
for them. A framework's route announcer (Next.js's `next-route-announcer`, and Gatsby's, Nuxt's and
SvelteKit's) is never an effect, nor is a live region that only reads out the page's title. Text
your app changes on its own in another way goes in `effects.ignore`.

The route a step ends on is kept as a template: the app's origin is `app`, and path segments that
look generated become `:id`: numbers, UUIDs, prefixed ids (`cs_test_…`, `ord_9xK2`), keyed numbers
(`PROJ-016`, `INV-2041`), hex ids of 8 or more with a digit (`8f3a2b1c`) and tokens of 8 or more
that switch between letters and digits at least twice (`abc123def`). Words and versioned names
(`windows11`) stay as they are. A `unique(...)` value in the path (as typed, percent-encoded,
`+` for spaces, or slugged) is kept as a placeholder (`app/companies/{company}`), filled with the
run's own value on replay.

A new `agent.act` recording is staged until a later check (an assertion, a value check or a passed
`agent.assert`) passes: the step reads `recorded, kept only if the test passes` while the attempt
runs, then at the end `recorded` (a check after it passed; its record's `cache.saved` is true),
`not kept: the test failed` (a later step failed before any check passed) or `not kept: no check
after it passed` (`saved` false for both). The `cache:` line counts them after the outcomes,
e.g. `cache: 3 replayed · 0 relocated · 0 handed off · 1 missed · 1 not kept: the test failed`; a
step not kept calls the model again next run.

A recording is keyed by the journey, the instruction as written and its params, not by the step's
position, so a step inserted before it changes nothing. The same instruction with the same params
twice in one test is two recordings: the second and later are keyed by their occurrence. A test
that runs the same steps as different people should name the person in `params`
(`{ persona: "admin" }`), since the key has no other account field.

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
