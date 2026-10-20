# Saved sessions

Sign in once per worker and start every test that needs it already signed in.

```ts
// danwo.config.ts
export default defineConfig({
  sessions: {
    ada: {
      async setup({ app, screen, secret }) {
        await app.open("/login")
        await screen.getByLabel("Email").fill("ada@shop.test")
        await screen.getByLabel("Password").fill(secret("password"))
        await screen.getByRole("button", { name: "Sign in" }).click()
      },
      async check({ app, screen, expect }) {
        await app.open("/account")
        await expect(screen.getByRole("heading", { name: "Account" })).toBeVisible()
      },
    },
  },
})
```

Use it per file or block with `test.use({ session: "ada" })`, per test with
`test(title, { session: "ada" }, body)`, and opt out with `{ session: false }`. A file can define
one with `test.session(name, setup)`.

- The setup runs in its own browser the first time a test needs the session; its cookies,
  localStorage and IndexedDB are kept and loaded into each test's fresh browser.
- `check` (optional) runs when a test reuses the state; when it throws, the session is set up
  again.
- With an environment that has `snapshot()` and `restore()`, the backend side of a sign-in (the
  user and session in the emulators and the app's database) is kept in the state every test starts
  from, so later tests reuse it although each starts isolated. A full reset drops the kept state,
  and each `danwo matrix` trial signs in afresh.
- Agent steps in a setup record and replay like any others.
- A failing setup fails the tests that use it with `SESSION_SETUP_FAILED`, once.
- The browser state is never written to flight records.

## A second person in one test

`users.open(name)` opens another person's browser beside the test's own, for "a teammate sees it
live" tests. It returns that person's own `app`, `screen`, `expect`, `agent`, `mail` and `secret`,
scoped to their browser; `{ session }` starts it from a saved session, else signed out.

```ts
test("a teammate sees a post the moment it is made", async ({ app, screen, expect, users }) => {
  const bob = await users.open("bob", { session: "bob-in-workspace" })

  await bob.app.open("/")
  await app.open("/")
  await screen.getByRole("textbox", { name: "Message" }).fill("Lunch at noon")
  await screen.getByRole("button", { name: "Post" }).click()
  await bob.expect(bob.screen.getByText("Lunch at noon")).toBeVisible()
})
```

- Names are letters, digits, `.`, `_` or `-`, and one name opens once per test (`CONFIG_INVALID`
  otherwise). `bob.close()` closes it early; every browser closes when the test ends.
- Each person's browser goes through the same proxy, emulators and clock (`time.travel` moves every
  browser). Their user agent ends in `danwo-user/<name>`, which is how the record tells their calls
  and sockets apart; no header is added, so no CORS preflight changes.
- The flight record tags their steps, calls, sockets and console lines with `user`, and films them
  apart (`video/<name>-tab-<n>.webm`).
- A session saved earlier in the worker is reused; otherwise its setup runs for this test alone and
  is not kept.
- Not supported on Android yet: `users.open` fails with `CONFIG_INVALID`.
