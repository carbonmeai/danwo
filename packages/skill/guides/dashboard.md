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
are the numbered steps, each with a "Go to" that seeks the video to it, and pinned under them the
error, where the body stopped, the faults and lint findings, "Copy prompt to fix" (the failure
page as a prompt for a coding agent, or as Markdown) and a vote on whether it helped (kept in
`.danwo/feedback.jsonl` on this machine). On the right are tabs (`&pane=`):

- **Replay**: the video (or the step screenshots when no video was kept) with play, speed and a
  scrubber marking steps and faults; `&t=12.5` opens it 12.5 seconds in, `#step-3` where step 3
  starts.
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
only failed runs with `record: "on-failure"`; the latest 20 runs keep theirs. Nothing the dashboard shows is new data: the
summaries and records are redacted when danwo writes them, so secrets never reach the page.

## Video

Every run is filmed while it runs, one video per tab (`video/tab-<n>.webm`) or the device's screen
(`video/screen.mp4`, Android, up to three minutes), and the record lists each step, call, webhook
and fault as an offset into it. Which videos are kept:

| `video` (config) or `--video` | Kept                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `retain-on-failure`           | with the records of runs that did not pass; a matrix keeps failing and invalid trials' |
| `on` (default)                | with every record kept; every run is kept by default (`record: "always"`)              |
| `off`                         | none; nothing is filmed                                                                |

A short test's video is tens of kilobytes. Video shows the screen as it was: fields holding a
secret show as dots, but a secret the app prints as text is on screen, and so is anything else the
page shows. Turn video off (`video: "off"`) for suites that show secrets.

When a test opened another person's browser (`users.open`), each person has their own video, named
`bob · tab 1` beside `you · tab 1` in the player. A person's video marks their own steps and calls
plus the app server's; the transcript tags each step with its person, draws a line where the test
moves to another person's browser, and its "Go to" switches to that person's video.
