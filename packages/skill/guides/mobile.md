# Mobile apps on Android and iOS

Run the same tests, invariants and fault matrix against a React Native or Expo app on an Android emulator or an iOS Simulator, through danwo's proxy and emulators. Android comes first below; the iOS Simulator section says what differs.

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
  the web; in `danwo matrix` they are paced by the clean run like web checks. `toHaveCSS` and
  `toBeInViewport` are web only: on a device they fail with `CONFIG_INVALID`.
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

## iOS Simulator

The same tests run on an iOS Simulator on a Mac. Select it however your config likes; the shop
uses `DANWO_PLATFORM=ios`:

```ts
import { IOS_BACKGROUND_HOSTS, iosWorkers, withIosDevice } from "@danwo/device"
import { buildIos } from "@danwo/expo"

// in defineConfig: workers: iosWorkers(),
// in environment({ workerIndex }):
const build = await buildIos({ project: "app" })
const services = await startServices([stripeService({ seed }), backendRoute], {
  blocked: IOS_BACKGROUND_HOSTS,
})

return withIosDevice(
  { ...servicesLifecycle, proxy: services.proxy, fixtures: services.fixtures, baseUrl, close },
  {
    worker: workerIndex,
    app: { bundleId: "com.danwo.shopmobile", app: build.app, scheme: "danwoshop" },
  },
)
```

**Setup.** Xcode (not only its command-line tools: `xcode-select -p` must point into
`Xcode.app`), an iOS runtime (Xcode → Settings → Components), and CocoaPods to build Expo apps.
`danwo device doctor --platform ios` checks them; without `--platform` the doctor checks both
platforms and passes when either is ready.

**The build.** `danwo build-ios [project]` (or `buildIos({ project })`): `expo prebuild --platform
ios` (installs the pods), App Transport Security set to `NSAllowsArbitraryLoads` alone (iOS ignores
it when a finer key such as `NSAllowsLocalNetworking` is present), then `xcodebuild` Release for
the simulator, this Mac's CPU only, `CODE_SIGNING_ALLOWED=NO`. Kept under
`<project>/.danwo/builds/<hash>.app`. The Expo config needs `ios.bundleIdentifier`. About 2
minutes from cold (pods included) and 100 s after a JavaScript change on Apple silicon.

**The simulator.** `withIosDevice` finds its simulator by name (default `danwo iPhone`; worker n
from the second on uses `danwo iPhone <n + 1>`), creates it when missing (the newest iOS runtime's
newest iPhone Pro, or `runtime` and `deviceType`), boots it headless and waits with `bootstatus`.
A simulator it booted is shut down on close; one it created is kept for the next run unless
`remove: true`. `udid` uses an existing simulator as it is.

**The network**, with nothing changed on the Mac:

1. `simctl keychain <udid> add-root-cert` trusts the run's CA for every process in the simulator
   (the app, Safari views, sign-in sessions). It survives reboots; there is no per-certificate
   removal, which is why danwo uses its own simulators.
2. The simulator's own system proxy (`State:/Network/Global/Proxies` in its configuration store,
   which it otherwise copies from the Mac) is pointed at the proxy on 127.0.0.1, by a small helper
   built with Xcode into `~/Library/Caches/danwo/ios` on first use and run with `simctl spawn`. The
   simulator shares the Mac's loopback, so nothing is forwarded. The setting lives in memory: it is
   written again before each attempt, and `close` puts back what was there.

Proxy environment variables (`SIMCTL_CHILD_HTTPS_PROXY`) do nothing: iOS's networking ignores them.

**Each attempt:** the app and Safari are stopped, the app's data container is emptied (its
metadata kept, `Documents`, `Library/Caches`, `Library/Preferences`, `SystemData` and `tmp`
recreated), `app.permissions` are granted with `simctl privacy`, and the app is launched with
`app.launchArgs` and `app.env`. The app's log (`log stream`, its process, `default` level and
above) goes to the flight record; `recordVideo` films each attempt.

**What differs from Android:**

- The driver measures in points; danwo scales boxes to screenshot pixels and taps back to points.
- A Safari view or sign-in session is read in the same tree; `device.foreground()` reports
  `com.apple.SafariViewService` with the page the proxy saw.
- A Safari view stays over the app when Checkout links back: the app must call
  `WebBrowser.dismissBrowser()` (iOS only) when the link arrives. A shared (not ephemeral)
  `ASWebAuthenticationSession` first asks "Wants to Use … to Sign In"; tap **Continue**.
- No heading role (`getByRole("heading")` finds nothing); find titles by text.
- `back()` uses the screen's back or close control. `press` knows Enter only.
- A tap the keyboard covers puts the keyboard away and taps the same element again.
- Agent recordings are keyed by platform (`ios:<bundle id>`): record once per platform.

The shop on an iPhone 17 Pro simulator (iOS 26.5): both tests in about 50 s with the agent's steps
replayed; the `buy-credits` matrix of 23 runs in 370 s on one simulator; the agent's matrix of 23
runs in 298 s on two.

## The flight record

Each attempt keeps:

- a screenshot after every step;
- the app's logcat lines, redacted;
- the screen tree and a screenshot when it failed.

The app's own calls are tagged `origin: "device"` among the exchanges, next to the page's and the
server's.

## Limits for now

- **Flutter.** Flutter apps draw their own widgets, and their accessibility tree is thin.
- **iOS: Simulator only.** Physical iPhones and native Swift apps without React Native are not covered yet.
- **Pinned apps.** Apps that pin certificates ignore danwo's CA.
- **Play images.** Google Play system images cannot be rooted.
- **Not yet.** `hover`, `setInputFiles`, `dragTo`, `mail.open`, agent steps that read mail, and
  saved sessions say they are not supported on devices yet.
- **Time travel** moves the services and the backend, not the device's clock.

## CI

- **Linux:** needs KVM (`/dev/kvm`) and an `x86_64` `google_apis` image; create the AVD with
  `avdmanager`.
- **macOS:** Apple silicon runs `arm64-v8a` images.

The slow tests run only when asked, and skip cleanly without an SDK and AVD, or without Xcode:

```bash
DANWO_ANDROID=1 DANWO_AVD=<avd> DANWO_AVD_SNAPSHOT=<snapshot> bun run test:slow packages/cli/test/android.slow.test.ts
DANWO_IOS=1 bun run test:slow packages/cli/test/ios.slow.test.ts
```
