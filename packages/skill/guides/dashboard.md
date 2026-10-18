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
- **A flight record**: the error and where the body stopped, the steps (with each step's cache
  outcome, its expected and observed effects, and the screenshot taken after it), the screen at
  failure, console errors, every call through the proxy with redacted headers and bodies, webhook
  deliveries, the emulators' state and the failure page.
- **Insights**: tests that flip between passing and failing across runs, the slowest tests and the
  ones that cost the most model money.
- **Impact**: the providers, app routes, webhooks and calls each test touched, the index
  `danwo test --changed` picks tests from.

## Where the data comes from

Every run adds a small summary to `.danwo/history/` (the latest 200 are kept), whatever its record
mode. Flight records under `.danwo/runs/` are kept for failed runs by default, or every run with
`record: "always"`; the latest 20 runs keep theirs. Nothing the dashboard shows is new data: the
summaries and records are redacted when danwo writes them, so secrets never reach the page.
