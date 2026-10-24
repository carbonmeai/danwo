# Mobile apps on Android and iOS

Run the same tests, invariants and fault matrix against an Expo, React Native or native app (SwiftUI, UIKit, Jetpack Compose, Views) on an Android emulator or an iOS Simulator, through danwo's proxy and emulators. Android comes first below; the iOS Simulator section says what differs, and the native section how native projects build. One package, `@danwo/mobile`, builds the app so it trusts danwo, then runs it on a simulator or emulator. `@danwo/cli` does not include it: `danwo init` adds it for the `mobile` and `both` engines, or add it at `@danwo/cli`'s version (`npm install -D @danwo/mobile@<version>`, `danwo --version` prints it). Without it, `danwo device doctor`, `build-android`, `build-ios` and a config importing it exit 2 with `PACKAGE_MISSING` naming that install.

```ts
import type { DeviceFixtures } from "@danwo/mobile"
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
   and warns about an emulator left with a proxy setting from an earlier run. In a project whose
   config calls `withAndroidDevice`/`buildAndroid` (or the iOS ones), `danwo doctor` runs the same
   checks for each platform the config uses, and Flutter's for a `pubspec.yaml`.

## The danwo build

An app trusts only the system's CAs unless its build says otherwise. `danwo build-android [project]`
makes a release APK of an Expo app with its JavaScript bundled (no Metro at test time):

- `expo prebuild`;
- a network security config that also trusts user-installed CAs, where danwo puts each run's CA;
- `gradlew assembleRelease --no-daemon` with `DANWO=1`, using Android Studio's JDK when
  `JAVA_HOME` is unset. Gradle and the Kotlin compiler run inside the build's own process, so the
  build leaves no daemon running.

The APK is kept under `<project>/.danwo/builds/`, keyed by a hash of the app's sources, so an
unchanged app is not built again. Use `--force` to rebuild. In a config, `buildAndroid({ project })`
from `@danwo/mobile` does the same. Ship store builds without it. One build of a project runs at a
time, across workers and processes (`buildIos` and `buildAndroid` alike): a lock file,
`.danwo/builds/build-android.lock` or `build-ios.lock`, holds the builder's pid; the other
workers wait, then reuse the kept build. A lock whose process has died is broken; waiting
more than 30 minutes fails naming the holder and the file to delete.

## The config

```ts
import {
  ANDROID_BACKGROUND_HOSTS,
  androidWorkers,
  buildAndroid,
  withAndroidDevice,
} from "@danwo/mobile"
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
- `adb` uses a remote device over adb instead; see below.
- `permissions` lists runtime permissions to grant before each launch.

## Remote devices over adb

`adb: "host:port"` runs a worker on a remote Android device instead of an emulator: a device
cloud's virtual device that exposes adb, a device farm's remote access session, a team's own farm,
or any `adb connect host:port` target. A value without a port is taken as the serial of a device
adb already lists (a USB phone), and is not connected or disconnected.

```ts
return withAndroidDevice(env, {
  avd: "danwo_spike", // used only when no adb target is set
  adb: process.env.CI === undefined ? undefined : ["10.0.4.12:5555", "10.0.4.13:5555"],
  worker: workerIndex,
  reverse: [8081], // a dev server the app calls on the device's 127.0.0.1:8081
  app: { package: "com.danwo.shopmobile", apk: build.apk },
})
```

- `DANWO_ADB_TARGET` (comma-separated) overrides `adb`, so CI points a config written for a local
  AVD at its devices. Worker n takes the nth target; a worker past the list fails with a message
  naming the counts, so run as many workers as targets (`--workers <n>`).
- danwo runs `adb connect`, waits up to `connectTimeoutMs` (default 30 s) for the device to be listed
  as `device`, and reads `ro.build.version.sdk`. It disconnects at the end only when it made the
  connection (adb did not answer "already connected").
- Nothing emulator-only runs on it: no boot, no `-snapshot`, no `emu` console command, no
  `emu kill`. `avd`, `snapshot` and `port` are ignored.
- The binding is the emulator's: `adb root` (after which danwo connects again, since restarting
  adbd drops a network connection), the CA pushed into the user store, Chrome's flags, animations
  and the captive-portal probe off, then `adb reverse tcp:8765 tcp:<proxy port>` and the device's
  proxy setting `127.0.0.1:8765`. The device never needs a route to the host; the proxy's traffic
  rides the adb connection. `reverse` adds more same-number ports.
- Closing restores a shared device: the APK danwo installed is uninstalled, apps it disabled for
  the link scheme are enabled again, the CA file and Chrome's flags are removed, adbd goes back to
  the shell user when danwo made it root (`adb unroot`, then a reconnect), the global
  settings it changed get their earlier values back (deleted when they had none), the proxy setting
  is cleared and the reverse rules removed.

Errors, each naming the target:

| Message starts                              | Cause                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `<target> is not reachable over adb`        | `adb connect` failed, or the device stayed offline / unlisted                         |
| `<target> has not authorized this computer` | the device lists as `unauthorized`: accept the prompt, or add `~/.android/adbkey.pub` |
| `<target> runs API <n>; danwo needs API 24` | older than Android 7, which has no network security config for a user CA              |
| `<target> cannot run adbd as root`          | a production build: use a virtual device or a userdebug / rooted build                |

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
  `fill`, `clear`, `check`, `uncheck`, `press(key)`, `longPress({ durationMs? })` (800 ms by
  default) and `selectOption(option)` (a spinner or dropdown: it opens the picker and taps the
  option) act on the single match. An action waits for
  the match to be enabled (`LOCATOR_NOT_READY … is disabled` when it never is), then reads the
  screen again and presses the element there, by that reading's ref, once two readings agree on
  where it is; one that left the screen is looked for once more. Headers with
  `accessibilityRole="header"` are headings. `getByRole(role, { checked, selected, disabled })`
  filters by state. `getAttribute(name)` takes web names: `data-testid`, `aria-label`,
  `aria-checked`, `aria-selected`, `aria-disabled`, `placeholder`, `value`, `role`.
- **`expect`:** `toBeVisible`, `toBeHidden`, `toHaveText`, `toContainText`, `toHaveValue`,
  `toBeEnabled`, `toBeDisabled`, `toBeChecked`, `toHaveCount` and `toHaveAttribute` retry like on
  the web; in `danwo matrix` they are paced by the clean run like web checks. `toHaveCSS`,
  `toHaveJSProperty` and `toBeInViewport` are web only: on a device they fail with
  `CONFIG_INVALID`, and so do `expect(screen).toHaveURL`, `app.url()` and `app.clipboard()`
  (a device app has no address). Locators join with `or()` and `and()` as on the web.
  `toHaveScreenshot()` compares an element's box, or `expect(screen)` the whole screen without its
  status bar, with a baseline; password fields and `mask` locators are painted over.
- **`agent`:** see below.
- **`app.open(path)`:** opens `<scheme>://<path>`. Without a path it starts the app afresh.
- **`device`:**
  - `foreground()` says whether a browser such as a Custom Tab is in front, and its URL;
  - `back()`;
  - `openLink(url)`;
  - `rebind()`;
  - `logs()`;
  - `swipe({ direction, within?, durationMs? })` or `swipe({ from, to, durationMs? })`: one finger,
    `direction` the way it moves (`left` turns a carousel on), across the middle half of `within`
    or the screen, in screenshot pixels, 300 ms by default; slow swipes turn carousels and pull
    lists to refresh;
  - `dismissKeyboard()`, which does nothing when no keyboard shows;
  - `longPress(ref, { durationMs? })` (800 ms by default) by a reading's ref, under the agent,
    the MCP server and a locator's `longPress`.

A Custom Tab is part of the screen: its web page reads through the same locators.

Readiness after each action waits for the services behind the app (with `settle`, webhooks are
played), then for the screen to stop changing; when the services did something meanwhile (a
browser posting its form just after the tap), it waits for them and the screen again.

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
`- button "Pay $5.00" [ref=e12]`, and says which app or browser page is in front. States show in
brackets: `[disabled]`, `[checked]` (`[checked=false]` on a checkbox or switch) and `[selected]`
(the active tab). It acts with device tools: `tap`, `fill`, `fill_secret`, `check`, `select`,
`press_key`, `scroll` (the screen or a list, any direction), `swipe` (a direction, the screen or an
element, `duration_ms`), `long_press` (`duration_ms`), `dismiss_keyboard`, `back`, `open_link` and
`wait_for`. Every action on a ref finds the element again on the latest screen first, waiting for
it to be enabled, so a ref from a view the screen has since changed under still presses the right
element; swipes, long presses and keyboard dismissals replay like the rest.

Replay follows the web's rules:

- **Recordings.** A step's actions are kept, each on a target a person would write
  (`getByTestId("buy")`, `getByRole("button", { name: "Pay $5.00" })`), once a later check
  confirms it. Params are kept by name, secrets by name only. A replay asks no model.
- **Relocation.** With `similar-v1` (the default) a renamed element is found by role and likeness
  of its name; with `exact`, never.
- **Strict stop.** `danwo matrix` replays only: a step that no longer replays stops the agent there,
  and the invariant judges the state. A step with no recording fails. On a device a trial's checks
  are paced only once its fault has fired, and wait at least 6 s (`matrix.checkPace.floorMs` sets
  another floor): an in-app browser can take seconds longer to open than in the clean run.
- **Effects.** A replay must change the screen and the services behind it as its recording did.
  Calls the proxy blocked (the device's background traffic, `ANDROID_BACKGROUND_HOSTS` with Chrome's
  notification and the Google apps' ad pings) are not effects.

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
import { buildIos, IOS_BACKGROUND_HOSTS, iosWorkers, withIosDevice } from "@danwo/mobile"

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

## Native apps (SwiftUI, UIKit, Jetpack Compose, Views) and Flutter

`danwo build-ios [project]` and `danwo build-android [project]` find what the folder holds, in this
order: `pubspec.yaml` → Flutter; an `.xcworkspace` (else `.xcodeproj`) at the top → Xcode; a
`settings.gradle(.kts)` with `gradlew` → Gradle (no wrapper is an error); a `package.json` →
Expo. `buildIos` / `buildAndroid` do the same from a config, and return `bundleId` / `package` read
from the build (`plutil` on the app's Info.plist, `aapt2 dump packagename` on the APK), so the
device options need no hard-coded id. Examples: `examples/with-swiftui`, `examples/with-compose`,
`examples/with-flutter`.

**Xcode.** `pod install` first for a workspace with a `Podfile` and no `Pods/`. The scheme is
`--scheme`, else the only one in `xcodebuild -list -json`, else the one named like the project;
it must be shared (in `xcshareddata`). `xcodebuild -project|-workspace … -configuration Release
-sdk iphonesimulator -destination "generic/platform=iOS Simulator" -derivedDataPath
<project>/.danwo/xcode ARCHS=<this Mac's> CODE_SIGNING_ALLOWED=NO build`; the `.app` is the
scheme's, else the only one in `Build/Products/<configuration>-iphonesimulator`. The kept copy's
Info.plist gets `NSAppTransportSecurity = { NSAllowsArbitraryLoads }` (plain HTTP through the
proxy). Key: the sources minus `build`, `DerivedData`, `Pods`, `xcuserdata` and dotfiles, plus the
scheme and configuration asked for.

**Gradle.** `./gradlew assemble<Variant> --console=plain --no-daemon
-Pkotlin.compiler.execution.strategy=in-process --init-script <…>/danwo-network.gradle` (variant
`release` by default, `--variant`). The init script adds, through AGP's variant API
(`variant.sources.res.addStaticSourceDirectory`, `variant.sources.manifests.addStaticManifestFile`),
danwo's network security config (system + user CAs, cleartext) and a manifest overlay with
`tools:replace="android:networkSecurityConfig"`: the APK trusts the run's CA with no change to the
project. The APK is the variant's only one under `*/build/outputs/apk/<flavor>/<type>/`; an
`-unsigned.apk` is signed with `~/.android/debug.keystore` by `apksigner` (the keystore is made
with `keytool` when missing). Key: the sources minus `build`, `local.properties` and dotfiles.

**Locators.** SwiftUI: `.accessibilityIdentifier` → `getByTestId`, `.accessibilityLabel` →
`getByLabel` (a text field's placeholder is not its name). Compose: `Modifier.testTag` →
`getByTestId` once the root sets `semantics { testTagsAsResourceId = true }`; a text field's
`label` → `getByLabel`; `semantics { heading() }` → `getByRole("heading")`. Compose reports a
`Button` as a tappable `android.view.View` holding a text and an empty `android.widget.Button`;
danwo reads it as one `button` named by its text (also `Checkbox`, `Switch`, `RadioButton`), so
`getByRole("button", { name })` works.

**The network needs nothing from a native app**: `URLSession` follows the simulator's proxy and
keychain; `HttpURLConnection` and OkHttp follow the emulator's proxy, and the danwo build trusts
the user CA. Pinned certificates still defeat it. Route the app's production API host to the
worker's local API with a `Service` whose route is `forwardTo(localUrl)`; the app ships unchanged.

**Flutter.** `flutter build ios --simulator --debug` (Flutter builds simulators in debug only;
`build/ios/iphonesimulator/Runner.app`, App Transport Security opened as for Xcode). Android:
`flutter build apk --release --config-only` (writes `local.properties` and the Gradle wrapper), then
the project's own `android/gradlew assembleRelease` with the same `--no-daemon`, in-process Kotlin
and `--init-script` network config as a Gradle build, `JAVA_HOME` defaulting to Android Studio's
JDK; the APK is `build/app/outputs/flutter-apk/app-release.apk` (the template signs release with the
debug key). Key: the sources minus `build`, `Pods`, `ephemeral`, `Generated.xcconfig` and the other
generated files; `ios/` and `android/` are sources. Network: Dart's `HttpClient` (the default for
`package:http`) ignores the device proxy and installed CAs; `cupertino_http`
(`CupertinoClient.defaultSessionConfiguration()`) follows the simulator's proxy and
`cronet_http` (`CronetClient.defaultCronetEngine()`, Play Services Cronet) follows the emulator's
global `http_proxy`, both checked on devices. A release APK needs `android.permission.INTERNET` in
the main manifest (the template puts it in debug and profile only). Locators: a `Semantics`
`identifier` → `getByTestId` on both (Android resource id, iOS identifier). iOS's accessibility
snapshot reports a text field as `Other` with role `TextInputSemanticsObject`; danwo reads it as a
`textbox`, so `getByLabel` finds it by its `labelText`. On Android a text field's label is only its
hint, which the driver does not read: find fields by `getByTestId`. Plain `Text` that is focusable
reads as a `button` on Android; find text by its identifier or text.

## Live sessions over MCP

`open_session` with `device: true` starts the environment as a worker would and drives its
`env.device` instead of a browser: the app is started afresh, and `path` (other than `/`) opens by
the app's link scheme. One process per session, the same idle close and slot limits as a browser
session; each session's environment boots its own device, so give the config room for it.

- `snapshot` reads the screen as `- role "name" [testId=…] [ref=e4]` lines, nested like the page
  tree, with `[disabled]`, `[checked]`, `[unchecked]` and `[selected]` (the active tab) states,
  headed by `device:` and `in front:` (the app, or a browser it opened, with its URL).
- `click` taps; `fill`, `fill_secret`, `check` (taps a switch or checkbox unless it already shows
  that state), `press` (taps the target first; iOS has Enter only), `navigate` (a path by the
  link scheme, a full URL, or `back`).
- Device only: `back`, `scroll` (`direction`, optionally inside a list's `target`), `tap_at`
  (`x`, `y` in screenshot pixels), `swipe` (`direction` the way the finger moves, optionally
  across a `target`, `duration_ms`), `long_press` (`target`, `duration_ms`) and
  `dismiss_keyboard`.
- Browser only, refused with a message: `hover`, `select`, `upload`, `drag`, `tabs`, `switch_tab`,
  `close_tab`, `dialog`, and `click` with `modifiers`, `button` or `double`.
- Locators take the page's grammar and chains (`getByRole`, `getByText`, `getByLabel`,
  `getByPlaceholder`, `getByTestId`, `.filter({ hasText })`, `.first()`, `.last()`, `.nth(n)`);
  `getByAltText` and `getByTitle` are refused. `check_locator` answers against the screen.
- A ref keeps naming its element across readings while its role, name and id stay the same. Each
  action reads the screen first: a ref that moved or went is refused with the screen as it is
  now, and nothing is tapped.
- `screenshot` paints over password fields, fields a secret was filled into and any secret's
  value. `start_recording` keeps masked screenshots, and with `video: true` films the screen;
  video is refused once a secret is filled. "Since the last call" lists the app's log warnings
  and errors.

## The flight record

Each attempt keeps:

- a screenshot after every step;
- the app's logcat lines, redacted;
- the screen tree and a screenshot when it failed.

The app's own calls are tagged `origin: "device"` among the exchanges, next to the page's and the
server's.

## Limits for now

- **Flutter.** Text fields are found by `getByTestId` on Android (their label is only a hint there); the app must call through `cupertino_http` / `cronet_http`.
- **iOS: Simulator only.** Physical iPhones are not covered yet.
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
