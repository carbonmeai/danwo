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

`examples/shop-mobile` is a complete project: an Expo app, its Node backend, the config and this
test.

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
import { withAndroidDevice } from "@danwo/device"
import { buildAndroid } from "@danwo/expo"
import { defineConfig, startServices, stripeService } from "@danwo/sdk"

export default defineConfig({
  workers: 1,
  readiness: { mode: "page+backend", settle: true },
  async environment() {
    const build = await buildAndroid({ project: "app" })
    const services = await startServices([stripeService({ seed }), backendRoute])
    // …start the backend with services.proxy.env()…

    return withAndroidDevice(
      { ...servicesLifecycle, proxy: services.proxy, fixtures: services.fixtures, baseUrl, close },
      {
        avd: "danwo_spike",
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
6. installs the APK.

Closing the environment removes the proxy setting and the reverse rules, and shuts down an emulator
it booted. Give the app's backend a host such as `shop.danwo.test` that the proxy routes to it, so
the build needs no address baked in.

Options:

- `snapshot` boots from a saved AVD snapshot instead of a cold boot. The binder redoes root, the CA
  and the proxy route.
- `serial` uses a running device as it is.
- `permissions` lists runtime permissions to grant before each launch.

## What a test gets

Every attempt starts the app afresh: data cleared, permissions granted, launched. Then:

- **`screen`:** `getByTestId` (React Native's `testID`), `getByRole`, `getByLabel`, `getByText`,
  `getByPlaceholder` and `getByDisplayValue` resolve on the accessibility tree. `click` (or `tap`),
  `fill`, `clear`, `check` and `uncheck` act on the single match. Headers with
  `accessibilityRole="header"` are headings.
- **`expect`:** `toBeVisible`, `toBeHidden`, `toHaveText`, `toContainText`, `toHaveValue`,
  `toBeEnabled`, `toBeDisabled`, `toBeChecked` and `toHaveCount` retry like on the web.
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

## The flight record

Each attempt keeps:

- a screenshot after every step;
- the app's logcat lines, redacted;
- the screen tree and a screenshot when it failed.

The app's own calls are tagged `origin: "device"` among the exchanges, next to the page's and the
server's.

## Limits for now

- **One worker, one emulator.**
- **Android only.** Flutter apps draw their own widgets, and their accessibility tree is thin.
- **Pinned apps.** Apps that pin certificates ignore danwo's CA.
- **Play images.** Google Play system images cannot be rooted.
- **Locators only.** No agent, replay or vision. `hover`, `press`, `setInputFiles`, `dragTo`,
  `selectOption`, `getAttribute`, `toHaveAttribute`, `toHaveScreenshot`, `mail.open` and saved
  sessions say they are not supported on Android yet.
- **Time travel** moves the services and the backend, not the device's clock.

## CI

- **Linux:** needs KVM (`/dev/kvm`) and an `x86_64` `google_apis` image; create the AVD with
  `avdmanager`.
- **macOS:** Apple silicon runs `arm64-v8a` images.

The slow test runs only when asked, and skips cleanly without an SDK or AVD:

```bash
DANWO_ANDROID=1 DANWO_AVD=<avd> bun run test:slow packages/cli/test/android.slow.test.ts
```
