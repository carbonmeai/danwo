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

Installed from npm, `@danwo/dashboard` ships a prebuilt build that `danwo serve` runs behind a
plain Node server, with no Vite and no build step; it depends on the runner alone. In danwo's own
repository it runs from source under Vite, keeping its pre-built dependencies in a folder keyed
by the installed packages (`node_modules/.vite/deps-<hash>`) and loading React once, so an
upgrade needs only a restart, never a cleared cache.

## Pages

The sidebar holds Overview, Tests, Runs, Matrix, Insights, Impact and Settings; it collapses to an
icon rail (`Cmd+B` or `Ctrl+B`). Every page, filter and open recording has its own address, and
"Copy link" in the top bar copies it.

- **Overview**: pass rate, runs, failed tests and average run time over 7, 30 or 90 days, each
  against the window before; runs per day (a bar opens that day's runs); pass rate and run time
  trends; "Worth a look" (the latest failing runs) and "Breaks under faults".
- **Tests**: every test in the project, grouped by file, with its latest result, last run, pass
  rate, the matrix's verdict ("breaks under …", "held under all", or none yet) and a thumbnail of
  its latest recording. "Run selected" and "Run all" start `danwo test` from the page.
- **Runs**: every `danwo test` and `danwo matrix` run in one table, filtered by status, kind and
  date, with the time, model spend and a menu per row. Runs still going show under "Running now".
- **A run**: a test run lists each test with its attempts and cache outcomes; a matrix run shows
  the invariant's verdict, the clean run and the fault grid (or list), with planned and skipped
  counts. Clicking a test or a trial opens its recording.
- **Matrix**: each test's latest matrix verdict and the faults that broke it, with "Run the
  matrix" (optionally limited to faults matching a filter).
- **Insights**: the table of every test (runs, pass rate, flake rate, median time, spend and the
  faults that break it, sortable), flaky tests, the slowest and costliest tests, the replay cache
  and integration lint findings.
- **Impact**: the providers, app routes, webhooks and calls each test touched, the index
  `danwo test --changed` picks tests from.
- **Settings**: the project folder, the config file, what `.danwo` keeps and the keyboard
  shortcuts.

### The recording

A recording opens over the page it was opened from (`?open=<record>`; Esc closes it). On the left
are the numbered steps, each with a "Go to" that seeks the video to it, then a **Checks** section
for what ran after the body: "Waiting for background work" (the settle wait, its time and each run
or delivery it waited for, e.g. `inngest · 2.3 s · notify completed in 0.4 s`) and every `expect()`
of a plain value in the invariant or the test, a ✓ or ✗ with what it got and, on failure, what it
wanted. Locator checks stay with the steps. Pinned under them are the error, where the body
stopped, the faults and lint findings, "Copy prompt to fix" (the failure page as a prompt for a
coding agent, or as Markdown) and a vote on whether it helped (kept in `.danwo/feedback.jsonl` on
this machine). On the right are tabs (`&pane=`):

- **Replay**: the video (or the step screenshots when no video was kept) with play, speed and a
  scrubber marking steps and faults; `&t=12.5` opens it 12.5 seconds in, `#step-3` where step 3
  starts. With a popup, it follows the run from tab to tab (see Video below). The scrubber shades "settling" and "checks", the idle tail after the last step, with a
  "Go to" for each; the tail plays at 4× unless "Idle at 4×" is turned off or the chosen speed is
  faster.
- **Console** with level filters, and **Network** with the page's requests.
- **Providers**: the waterfall of steps, provider calls, webhooks and faults, then the calls and
  webhooks as tables; a call opens its redacted request and response.
- **Emulator state** and **Effects** (what each step was expected to change and what it did).
- **Matrix**, on a trial: the fault it ran under and the trial's verdict.

### Live runs and running from the page

While `danwo test` or `danwo matrix` runs, the run streams into the dashboard: tests and trials as
they start and finish, each step and the calls, webhooks and faults behind it, with the elapsed
time and model spend; the tab's title and icon show the state. A run started from a terminal shows
up too. From the page you can rerun a run's failed tests or one test, run the matrix for a test,
run selected tests, and cancel a run in progress; the dashboard starts the CLI with fixed
arguments for tests the project lists, one run at a time, with further requests queued.

## Where the data comes from

Every run adds a small summary to `.danwo/history/` (the latest 200 are kept), whatever its record
mode. Flight records under `.danwo/runs/` are kept for every run by default (`record: "always"`), or
only failed runs with `record: "on-failure"`; the newest 50 runs keep theirs
(`record: { mode, keepRuns }` in the config, `--keep-runs <n>` for one run), and older runs'
folders are deleted as each run finishes. A row whose recordings were deleted reads "recording
deleted" and its Watch button is turned off; a recording opened by an old link shows why it is
gone, when its run was, and a rerun of the test. Nothing the dashboard shows is new data: the
summaries and records are redacted when danwo writes them, so secrets never reach the page.

## Whose failure

Every failed test and trial carries a verdict (app bug, test issue, environment, danwo bug or
undecided; certain or likely) with its reason. The dashboard shows it as a badge on failed rows
and in a recording's header (a "?" marks a likely one, the reason is in its tooltip), splits the
run page's Failed card by it, and filters Runs and Tests by it (**Whose failure**, `?verdict=app`).
The debugging guide lists the rules.

## Video

Every run is filmed while it runs, one video per tab (`video/tab-<n>.webm`) or the device's screen
(`video/screen.mp4`, Android, up to three minutes), and the record lists each step, call, webhook
and fault as an offset into it. Which videos are kept:

| `video` (config) or `--video` | Kept                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `retain-on-failure`           | with the records of runs that did not pass; a matrix keeps failing and invalid trials' |
| `on` (default)                | with every record kept; every run is kept by default (`record: "always"`)              |
| `off`                         | none; nothing is filmed                                                                |

A short test's video is tens of kilobytes (50 to 250 KB is typical); a run's folder is usually
under 1 MB for a small suite, so the 50 runs kept come to tens of megabytes, more with Android
screen recordings. Video shows the screen as it was: fields holding a
secret show as dots, but a secret the app prints as text is on screen, and so is anything else the
page shows. Turn video off (`video: "off"`) for suites that show secrets.

When a test opened another person's browser (`users.open`), each person has their own video, named
`bob · tab 1` beside `you · tab 1` in the player. A person's video marks their own steps and calls
plus the app server's; the transcript tags each step with its person, draws a line where the test
moves to another person's browser, and its "Go to" switches to that person's video.

A popup or a new tab the app opens (an OAuth "Connect your account" page) is filmed as the next tab
(`video/tab-2.webm`). Each step records the tab it ran in (`tab` in the record). A check that found
its element in the popup counts as the popup's. Each video records the tab that opened it
(`opener`), the host of its first page (`host`) and whether it closed before the browser did
(`closed`).

- While it plays, the player switches to the tab of the running step and keeps playing. When the
  popup's video ends, it goes back to the tab that opened it.
- The scrubber and the transcript mark "Popup opened: <host>" and "Back to the app".
- The popup's steps carry a `popup` badge, and "Go to" shows the step's tab.
- The clock and the step times read from the first video, so they don't change with the tab.
- The Tab buttons still pick a tab by hand. That tab stays until the next step starts.

Filmed pages draw a cursor that moves to each element before an action, the agent's included:

- a box around the element;
- a ripple on a click, check, select, upload or drag;
- a "typing" badge on a fill or press.

The cursor sits in a shadow root above the page, with `pointer-events: none`, and changes no
layout. It is hidden from `toHaveScreenshot` pictures and from the model's screenshots, though not
from the step screenshots. It is drawn only when video is on and costs about 0.2 s per action.
Turn it off with `video: { mode: "on", cursor: false }`.
