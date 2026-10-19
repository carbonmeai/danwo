# Mobile apps on Android

Run the same tests, invariants and fault matrix against a React Native or Expo app on an Android emulator, through danwo's proxy and emulators.

```ts
import type { DeviceFixtures } from "@danwo/device"
import { type StripeFixtures, test as base } from "@danwo/sdk"

const test = base.extend<StripeFixtures & DeviceFixtures>()

test("buys 500 credits", async ({ screen, expect, device }) => {
  await screen.getByTestId("buy").tap()
  /* Checkout opens in a Custom Tab; the same locators read the web page. */
  await screen.getByLabel("Email").fill("buyer@example.com")
  await screen.getByRole("button", { name: "Pay $5.00" }).tap()
  await expect(screen.getByTestId("credits")).toHaveText("Credits: 500")
}).invariant(async ({ app, stripe, expect }) => {
  expect(await grantedCredits(app.baseUrl, "u1")).toBe(await paidCredits(stripe, "u1"))
})
```

`examples/shop-mobile` is a complete project: an Expo app, its Node backend, the config, this
test and the same purchase told to the agent in plain words.

## Setup

1. Install Android Studio. It brings the SDK (`adb`, the emulator) and a JDK.
2. Create an AVD from a **Google APIs** system image, e.g. `system-images;android-34;google_apis;arm64-v8a`
   (use `x86_64` on Intel and Linux). Play Store images cannot be rooted, and danwo needs root to
   trust its CA.
3. Run `danwo device doctor`. It checks the SDK, adb, the emulator, rootable images, AVDs and a JDK,
   and warns about an emulator left with a proxy setting from an earlier run.

## The danwo build

An app trusts only the system's CAs unless its build says otherwise. `danwo build-android [project]`
makes a release APK of an Expo app with its JavaScript bundled (no Metro at test time):

- `expo prebuild`;
- a network security config that also trusts user-installed CAs, where danwo puts each run's CA;
- `gradlew assembleRelease` with `DANWO=1`, using Android Studio's JDK when `JAVA_HOME` is unset.

The APK is kept under `<project>/.danwo/builds/`, keyed by a hash of the app's sources, so an
unchanged app is not built again. Use `--force` to rebuild. In a config, `buildAndroid({ project })`
from `@danwo/expo` does the same. Ship store builds without it.

## The config

```ts
import { ANDROID_BACKGROUND_HOSTS, androidWorkers, withAndroidDevice } from "@danwo/device"
import { buildAndroid } from "@danwo/expo"
import { defineConfig, startServices, stripeService } from "@danwo/sdk"

export default defineConfig({
  /* One emulator per worker, as many as the machine has room for (at most three). */
  workers: androidWorkers({ avd: "danwo_spike" }),
  readiness: { mode: "page+backend", settle: true },
  cache: { dir: "tests/__recordings__" },
  model: "anthropic/claude-sonnet-5.5",
  async environment({ workerIndex }) {
    const build = await buildAndroid({ project: "app" })
    const services = await startServices([stripeService({ seed }), backendRoute], {
      blocked: ANDROID_BACKGROUND_HOSTS,
    })
    // …start the backend with services.proxy.env()…

    return withAndroidDevice(
      { ...servicesLifecycle, proxy: services.proxy, fixtures: services.fixtures, baseUrl, close },
      {
        avd: "danwo_spike",
        worker: workerIndex,
        snapshot: "danwo_clean",
        app: { package: "com.danwo.shopmobile", apk: build.apk, scheme: "danwoshop" },
      },
    )
  },
})
```

`withAndroidDevice` boots the AVD headless (or uses one already running), then binds it to the run:

1. `adb root`;
2. pushes the run's CA into the user trust store;
3. prepares Chrome (no first-run screens or notification prompt);
4. turns off animations and the captive-portal probe;
5. routes the device's traffic through the proxy with `adb reverse` and a proxy setting;
6. installs the APK, and disables any other app that claims its link scheme (an older build kept
   in a snapshot would put an "Open with" chooser in the way of links back from the browser).

`ANDROID_BACKGROUND_HOSTS` blocks the emulator's own traffic at the proxy: Chrome's sync and
optimization hints, safe browsing and Play services check-ins. Chrome on the device also runs with
background networking off. That traffic is never routed, so `danwo matrix` plans no faults on it.

Closing the environment removes the proxy setting and the reverse rules, and shuts down an emulator
it booted. Give the app's backend a host such as `shop.danwo.test` that the proxy routes to it, so
the build needs no address baked in.

Options:

- `snapshot` boots from a saved AVD snapshot instead of a cold boot (seconds instead of a minute).
  The binder redoes root, the CA and the proxy route.
- `worker` gives each worker its own emulator: worker n uses the console port 5554 + 2n, so the
  serial `emulator-<port>`, and its own driver state and proxy route. Every boot is read-only, so
  several instances share one AVD and its snapshots.
- `serial` uses a running device as it is.
- `permissions` lists runtime permissions to grant before each launch.

## Parallel emulators

`androidWorkers({ avd, max })` sizes `workers`: an emulator takes its AVD's RAM plus about a gigabyte,
and two cores. It allows as many as half the memory and the cores fit, at most `max` (default 3),
and one on a machine already loaded past its cores. `danwo matrix --workers <n>` overrides it.

The shop's matrix of 29 runs, on a 12-core, 32 GB Apple silicon machine:

| Emulators | Wall time | Median trial |
| --------- | --------- | ------------ |
| 1         | 160 s     | 4.6 s        |
| 2         | 103 s     | 5.6 s        |
| 3         | 95 s      | 7.1 s        |

Two emulators are the sweet spot there; a third mostly slows each trial down.

## What a test gets

Every attempt starts the app afresh: data cleared, permissions granted, launched. Then:

- **`screen`:** `getByTestId` (React Native's `testID`), `getByRole`, `getByLabel`, `getByText`,
  `getByPlaceholder` and `getByDisplayValue` resolve on the accessibility tree. `click` (or `tap`),
  `fill`, `clear`, `check`, `uncheck`, `press(key)` and `selectOption(option)` (a spinner or
  dropdown: it opens the picker and taps the option) act on the single match. Headers with
  `accessibilityRole="header"` are headings. `getAttribute(name)` takes web names:
  `data-testid`, `aria-label`, `aria-checked`, `aria-disabled`, `placeholder`, `value`, `role`.
- **`expect`:** `toBeVisible`, `toBeHidden`, `toHaveText`, `toContainText`, `toHaveValue`,
  `toBeEnabled`, `toBeDisabled`, `toBeChecked`, `toHaveCount` and `toHaveAttribute` retry like on
  the web; in `danwo matrix` they are paced by the clean run like web checks.
  `toHaveScreenshot()` compares an element's box, or `expect(screen)` the whole screen without its
  status bar, with a baseline; password fields and `mask` locators are painted over.
- **`agent`:** see below.
- **`app.open(path)`:** opens `<scheme>://<path>`. Without a path it starts the app afresh.
- **`device`:**
  - `foreground()` says whether a browser such as a Custom Tab is in front, and its URL;
  - `back()`;
  - `openLink(url)`;
  - `rebind()`;
  - `logs()`.

A Custom Tab is part of the screen: its web page reads through the same locators.

Readiness after each action waits for the services behind the app (with `settle`, webhooks are
played), then for the screen to stop changing.

## The agent

`agent.act`, `agent.extract`, `agent.assert` and `agent.waitFor` work on a device as on the web:

```ts
const { credits } = await agent.extract("the credits balance", z.object({ credits: z.number() }))

await agent.act("Start buying 500 credits")
await agent.act("Pay for the credits with the email {email}", {
  params: { email: "buyer@example.com" },
})
await expect(screen.getByTestId("credits")).toHaveText(`Credits: ${credits + 500}`)
```

The model reads the screen in the page view's format, one line per element with its ref, e.g.
`- button "Pay $5.00" [ref=e12]`, and says which app or browser page is in front. It acts with
device tools: `tap`, `fill`, `fill_secret`, `check`, `select`, `press_key`, `scroll` (the screen or
a list, any direction), `back`, `open_link` and `wait_for`.

Replay follows the web's rules:

- **Recordings.** A step's actions are kept, each on a target a person would write
  (`getByTestId("buy")`, `getByRole("button", { name: "Pay $5.00" })`), once a later check
  confirms it. Params are kept by name, secrets by name only. A replay asks no model.
- **Relocation.** With `similar-v1` (the default) a renamed element is found by role and likeness
  of its name; with `exact`, never.
- **Strict stop.** `danwo matrix` replays only: a step that no longer replays stops the agent there,
  and the invariant judges the state. A step with no recording fails.
- **Effects.** A replay must change the screen and the services behind it as its recording did.
  Calls the proxy blocked (the device's background traffic) are not effects.

**Vision.** Icons with no name and pictures of text show only on the screen. With `vision` on
(`auto` by default) the agent may `look`: a screenshot at half size with numbered marks over what
can be tapped, password fields and fields a secret went into painted over. It then uses `tap_at`
or `type_at`. Such an action is recorded as a gray patch of the screen around its point; a replay
finds the patch where it was or, when it may relocate, where it moved, with no model call. The
judge of `agent.assert` sees a screenshot too when the screen has unnamed controls.

The shop's agent test, recorded with `anthropic/claude-sonnet-5.5`: 6 model calls, about $0.02 and
17 s live; replayed, 0 calls and about 6 s. Its matrix runs all 28 faults on two emulators with no
model call. `DANWO_MODEL=scripted` records with the shop's own scripted model, for machines
without a model key.

## The flight record

Each attempt keeps:

- a screenshot after every step;
- the app's logcat lines, redacted;
- the screen tree and a screenshot when it failed.

The app's own calls are tagged `origin: "device"` among the exchanges, next to the page's and the
server's.

## Limits for now

- **Android only.** Flutter apps draw their own widgets, and their accessibility tree is thin.
- **Pinned apps.** Apps that pin certificates ignore danwo's CA.
- **Play images.** Google Play system images cannot be rooted.
- **Not yet.** `hover`, `setInputFiles`, `dragTo`, `mail.open`, agent steps that read mail, and
  saved sessions say they are not supported on Android yet.
- **Time travel** moves the services and the backend, not the device's clock.

## CI

- **Linux:** needs KVM (`/dev/kvm`) and an `x86_64` `google_apis` image; create the AVD with
  `avdmanager`.
- **macOS:** Apple silicon runs `arm64-v8a` images.

The slow test runs only when asked, and skips cleanly without an SDK or AVD:

```bash
DANWO_ANDROID=1 DANWO_AVD=<avd> DANWO_AVD_SNAPSHOT=<snapshot> bun run test:slow packages/cli/test/android.slow.test.ts
```
