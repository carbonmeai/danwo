# The dashboard

Browse every run in a browser: runs, flight records, matrix grids, flaky tests and what each test touches behind the app.

```sh
danwo serve          # http://127.0.0.1:4310/
danwo serve --open   # and open it
danwo serve -p 0     # any free port
```

`danwo serve` runs a local server on 127.0.0.1 for the project around the current folder (the
folder of the nearest `danwo.config.ts`). It reads the project's `.danwo` folder and never writes
to it, so it can stay open while you run tests; reload a page to see new runs.

## Pages

- **Runs**: every `danwo test` and `danwo matrix` run, newest first, with pass, fail, flaky,
  not-judged and invalid counts, how long it took, and the model calls and money it spent.
- **A test run**: each test with its status, attempts and how its agent steps used the replay
  cache, and a link to every attempt whose flight record was kept.
- **A matrix run**: the clean run and a card per fault, failures first. Not-judged and invalid
  runs read apart from failures. A card opens its trial's flight record.
- **A flight record**: the error and where the body stopped, the replay player, the steps (with
  each step's cache outcome, its expected and observed effects, and the screenshot taken after it),
  the screen at failure, console errors, every call through the proxy with redacted headers and
  bodies, webhook deliveries, the emulators' state and the failure page.
- **The replay player**: the run's video (or, when it kept none, its step screenshots in time
  order) with play, pause, speed and a scrubber marking every step and fault. "Go to" on a step
  seeks there; the step on screen is highlighted and a line follows it down the waterfall, and
  clicking a call, webhook or fault in the waterfall seeks the video to it. A link opens the player
  at a moment: `?t=12.5` is 12.5 seconds in, `#step-3` is where step 3 starts; the player's link
  button copies one.
- **Insights**: tests that flip between passing and failing across runs, the slowest tests and the
  ones that cost the most model money.
- **Impact**: the providers, app routes, webhooks and calls each test touched, the index
  `danwo test --changed` picks tests from.

## Where the data comes from

Every run adds a small summary to `.danwo/history/` (the latest 200 are kept), whatever its record
mode. Flight records under `.danwo/runs/` are kept for failed runs by default, or every run with
`record: "always"`; the latest 20 runs keep theirs. Nothing the dashboard shows is new data: the
summaries and records are redacted when danwo writes them, so secrets never reach the page.

## Video

Every run is filmed while it runs, one video per tab (`video/tab-<n>.webm`) or the device's screen
(`video/screen.mp4`, Android, up to three minutes), and the record lists each step, call, webhook
and fault as an offset into it. Which videos are kept:

| `video` (config) or `--video` | Kept                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `retain-on-failure` (default) | with the records of runs that did not pass; a matrix keeps failing and invalid trials' |
| `on`                          | with every record kept (`--record always` keeps every run)                             |
| `off`                         | none; nothing is filmed                                                                |

A short test's video is tens of kilobytes. Video shows the screen as it was: fields holding a
secret show as dots, but a secret the app prints as text is on screen, and so is anything else the
page shows. Turn video off (`video: "off"`) for suites that show secrets.
