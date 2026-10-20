# Debugging a failure

Every failed run keeps a flight record under `.danwo/runs/<run>/`; start from its failure page.

1. `danwo show --format md` prints one page per failed test or matrix trial of the newest run
   (`danwo show <run-id> --format md` for another). Over MCP, `show_run` with `format: "md"` gives
   the same page. `danwo show --open` opens the HTML report with screenshots and the run's video;
   `danwo serve` replays the video with the steps and provider calls moving along with it.
2. Read the top: the error code and class, the test file line the failure went through, and where
   the body stopped.
3. Then the steps: each with its cache outcome (`replayed`, `relocated`, `handed-off`, `missed`,
   `stale`, `diverged`), its model calls and cost.
4. Then what was behind the page: console errors, the failed or faulted provider calls through the
   proxy, webhook deliveries and the emulators' state at the end.

## What the code says to do

| Code                                        | Look at                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LOCATOR_NOT_FOUND`, `LOCATOR_AMBIGUOUS`    | the screen at failure and the nearest candidates; fix the locator with MCP `check_locator`                                                       |
| `EXPECTATION_FAILED`                        | expected vs received; is the app wrong, or the expectation?                                                                                      |
| `CLAIM_FAILED`                              | the judge's reason; the claim may be too strict or the app wrong                                                                                 |
| `APP_ERROR`                                 | the app's own 5xx or uncaught error during the step: an app bug                                                                                  |
| `PROVIDER_ERROR`                            | the provider call that failed (often a fault the matrix injected) and whether the app recovered; check the emulator state and webhook deliveries |
| `STALE_RECORDING`, `NOTHING_RECORDED`       | the step's recording key changed or never existed: rerun `danwo test` to record, then the matrix                                                 |
| `AGENT_LOOPING`, `BUDGET_EXCEEDED`          | the step instruction is too vague or the page changed; split the step or use locators                                                            |
| `MODEL_OUTPUT_INVALID`, `MODEL_UNAVAILABLE` | the model provider, not the app; retry or change model                                                                                           |
| `BROWSER_FAILED`, `ENVIRONMENT_FAILED`      | the browser or the environment hook: app start-up, emulators, ports                                                                              |
| `CONFIG_INVALID`                            | the config or the call named in the message                                                                                                      |

`danwo spec --topic errors` lists every code with its class and exit code. `danwo cache ls`,
`stats` and `clear` show and reset recordings.

## Proxy noise

A browser dropping a stream or socket as a page or test closes (`read ECONNRESET`, `EPIPE`,
`socket hang up`) is expected and not printed. Set `DANWO_DEBUG=proxy` (a comma-separated list, or
`*`) to see those lines when chasing a connection problem; every other proxy error always prints.
