# Locators or the agent

Use locators for steps you can name exactly; use the agent for steps that are easier to say than
to pin down. Both can live in one test.

## Locators

`screen.getByRole("button", { name: "Pay" })`, `getByLabel`, `getByText`, `getByPlaceholder`,
`getByDisplayValue` and `getByTestId` find elements the way a user names them. A string matches as
a case-insensitive substring unless you pass `{ exact: true }`; a RegExp tests the whole name.
Actions (`click`, `longPress`, `fill`, `press`, `check`, `selectOption`, `hover`, `setInputFiles`,
`dragTo`) need exactly one match and wait for the element to be ready. `longPress({ durationMs })`
(800 ms by default) waits as `click` does, then on a web page moves the mouse to the element's
centre, presses, holds and lets go; on a device it holds the element by the latest reading's ref.
Its step label reads `….longPress(durationMs: 600)`. Narrow with `.first()`, `.nth(i)`,
`.filter({ hasText, hasNotText, has, hasNot })` (every option given must hold; `has` and `hasNot`
take a locator from the same screen) or by chaining another `getBy…`. `a.or(b)` matches what either
finds, in page order (`save.or(screen.getByText("Saved"))` waits for whichever shows; an action
still needs exactly one), `a.and(b)` what both find; both work on devices too. A locator that
matches nothing or too many says how many each call of its chain left:
`matched nothing within 10000 ms; by step: getByRole("listitem") 3, .filter(hasText: "Kiwi") 0`,
and so does an `expect` that found no element.

`expect(locator)` checks retry until they hold: `toBeVisible`, `toBeHidden`, `toBeEnabled`,
`toBeDisabled`, `toBeChecked`, `toBeInViewport` (some of it inside the viewport as scrolled now),
`toHaveText`, `toContainText`, `toHaveValue`, `toHaveCount`, `toHaveAttribute`,
`toHaveCSS(property, value)` (the computed style, as the browser writes it: `"rgb(0, 0, 0)"`, not
`"black"`), `toHaveJSProperty(name, value)` (the DOM element's property, `checked`, `value`,
`dataset`, compared deeply) and `toHaveScreenshot`. Each has a `.not` form except `toHaveScreenshot`,
which throws if negated.

`expect(screen).toHaveURL(expected)` (and `.not`) waits for the active tab's address like the
locator checks: a RegExp tests the whole address, a string is resolved against `app.baseUrl`
(`"/orders?tab=items"`, or a full URL) and must equal it, query and hash included. `app.url()`
reads the address once without waiting. `app.clipboard()` returns the clipboard's text as the page
reads it (what a copy button wrote); Chromium only, and only with `browser: { contextOptions: {
permissions: ["clipboard-read", "clipboard-write"] } }` in the config, else `CONFIG_INVALID`
naming that setting. All three are web only: on a device they fail with `CONFIG_INVALID`.

`check`/`uncheck` (and the agent's check) handle a styled checkbox or radio whose invisible
`<input>` is covered by its own `<label>`: danwo clicks the label, then fails unless the input
changed. Every action but `press` and `setInputFiles` takes `{ force: true }`, which skips the
visible, stable, enabled and not-covered checks; use it only on a control a user can reach that an
action keeps timing out on (an endlessly animating button), since it also clicks disabled or
covered elements.

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
  recorded effects on the page and behind it (a page effect is waited for up to the action
  timeout, a provider call made by background work up to 10 s). Effects include the states a step
  changes in place: `checkbox "Agree" [checked]`, `[expanded]`, `[selected]`, `[pressed]`.
- `assert` and `waitFor`: the judge names a short text on the page that shows the claim holds; a
  replay waits for that text. A claim with no such text (something is absent) asks the judge each
  run. The text can stay while the claim stops holding (a total that no longer matches its
  items); `agent.assert(claim, { replay: false })` asks the judge every run and keeps no
  recording (cache outcome `off`; fails under `--replay-only`).
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

A recording finds each element by what it is, never by where it sits, so a step whose meaning is a
position ("open the first row", "the last order") replays as the element it found the first time:
after a newer row moves to the top, the replay still opens the old one, and its effects match, so
nothing hands off. Write the position as a locator (`screen.getByRole("row").nth(1).click()`, or
`.first()`/`.last()` on a list scoped by `getBy…` or `filter`) and give the agent what follows, or
name the item in `params` (`"open the invoice {number}"`). `agent.act` has no position option, on
purpose: a step is a run of actions and a position belongs to one target the option could not
name; an index among every element of a role counts header rows and other lists on the page, so it
is no steadier than the name; and when the position is meant, a locator already says it exactly.

A recording is keyed by the journey, the instruction as written and its params, not by the step's
position, so a step inserted before it changes nothing. The same instruction with the same params
twice in one test is two recordings: the second and later are keyed by their occurrence. A test
that runs the same steps as different people should name the person in `params`
(`{ persona: "admin" }`), since the key has no other account field.

Each recording keeps the model that made it (`recordedBy`, e.g. `openai/gpt-5-mini`; the judge for
`assert` and `waitFor`). A different configured model still replays it with no call, and the step's
cache note says `recorded with openai/gpt-5-mini, running anthropic/claude-sonnet-5`; the `cache:`
line ends with `recorded with … (n steps), running …`. Clear the cache to have the new model run
them.

The agent reads the page as an accessibility tree cut to fit its model: a quarter of the model's
input window at about four characters a token, between 8 000 and 120 000 characters. Known
families (Claude, GPT, o-series, Gemini, Llama, Mistral, DeepSeek, Qwen, Grok) are matched by model
id; an unknown model gets 120 000 (a 128k window). The tree is redacted before it is cut. An
`act`, `assert`, `waitFor` or `extract` step whose view was cut has one `view-cut` event in its
record (`chars`, `kept`), so a step that missed something far down a long page says why. Page text is never an instruction to the
agent, and its prompts say so: a page reading "ignore your instructions" changes nothing. After
every action (a locator's or the agent's) readiness also waits, up to 3 s, while the page shows a
loading state: an element with `aria-busy="true"`, a progress bar with no value, or a `status` that
starts with "Loading".

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

A control with no name (a clickable `div` or a button holding only an SVG) shows in the view as
`generic [ref=e4] [cursor=pointer]` or a bare `button`. When its markup names its icon, the view
adds it: `[icon="trash"]`, read from an icon-library class (`lucide-trash`, `fa-trash`, `bi-`,
`mdi-`, `ri-`, `ti-`, `ph-`, `icon-*`, `*-icon`), `data-icon`, `<use href="#trash">`, an
`<iconify-icon>` or an image file such as `trash.svg`. The agent clicks it by ref, and the
recording finds it again by icon (with `nth` among same-icon controls), with no model. Up to 60
unnamed controls a view get the word, about 15 characters each; a page with none reads exactly as
its accessibility tree. Prefer `aria-label` in the app: it names the control for people, locators
and the agent alike.

Some of a page is not in the text the agent reads at all: a canvas or chart, a control with neither
a name nor an icon its markup names, a widget in a frame the view cannot list. With `vision` on (`auto` by default) the agent is told
when a page has such parts and can `look` at a screenshot with numbered marks, then click, type,
drag or scroll at a mark or at coordinates. Those actions replay with no model call: each place is
found again by how it looks, at the same spot of the same element, and searched for when it moved
(never under strict replay). A changed picture hands the step back to the model, or diverges under
strict replay. `agent.assert` and `agent.extract` see a screenshot the same way, and
`act(..., { vision: false })` keeps a step to the text view. Forms inside frames, even from another
origin, need no image: the agent reaches them through the text view and replays them by frame.
