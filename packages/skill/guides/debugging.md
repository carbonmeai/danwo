# Debugging a failure

Every failed run keeps a flight record under `.danwo/runs/<run>/`; start from its failure page.

1. `danwo show --format md` prints one page per failed test or matrix trial of the newest run
   (`danwo show <run-id> --format md` for another). Over MCP, `show_run` with `format: "md"` gives
   the same page. `danwo show --open` opens the HTML report with screenshots and the run's video;
   `danwo serve` replays the video with the steps and provider calls moving along with it.
2. Read the top: the error code and class, the test file line the failure went through, and where
   the body stopped.
3. Then the steps: each with its cache outcome (`replayed`, `relocated`, `handed-off`, `missed`,
   `stale`, `diverged`; a `handed-off` or `diverged` one says what stopped matching), its model
   calls and cost. "Checks" follows: the wait for background work
   with how long it took and what it waited for (a run that took long, or an event that started
   no run), then each value check of the invariant or test, ✓ or ✗, with expected vs actual.
   Every step in the record carries its phase (`setup`, `body`, `settle`, `checks`, `teardown`);
   value checks are steps of kind `check` and the wait one of kind `settle`.
4. Then what was behind the page: console errors, the failed or faulted provider calls through the
   proxy, webhook deliveries and the emulators' state at the end.

## Whose failure it is

Each failed attempt carries a verdict, at the top of its failure page, in the CLI's failure header
(`[App bug]`, with a `why:` line), the summary line, the dashboard, the pull request comment and
the GitHub check. It says what to fix first. The rules, in order:

| Evidence                                                                           | Verdict                                             |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| the run was interrupted                                                            | undecided, certain                                  |
| `ENVIRONMENT_FAILED`, `BROWSER_FAILED`, `MODEL_UNAVAILABLE`                        | environment, certain                                |
| `CONFIG_INVALID`, `SECRET_REFUSED`                                                 | test issue, certain                                 |
| a blocked or inconclusive code                                                     | undecided, certain                                  |
| `APP_ERROR`, `PROVIDER_ERROR`                                                      | app bug, certain                                    |
| a matrix trial whose check (not a crash) failed under its fault                    | app bug, certain                                    |
| `TEST_FAILED` with a `TypeError`-like crash whose top frame is inside danwo        | danwo bug, likely: report it with the flight record |
| any other `TEST_FAILED`                                                            | test issue (certain with a test file line)          |
| a failed `agent.assert` (`CLAIM_FAILED`) with no app error while its work ran      | undecided, likely                                   |
| an app that stopped                                                                | app bug, certain                                    |
| an unfaulted 5xx from the app on a write (not GET/HEAD) while the failing work ran | app bug, certain                                    |
| any other unfaulted 5xx from the app, or an uncaught page error                    | app bug, likely                                     |
| `LOCATOR_*`, `SESSION_SETUP_FAILED`, an agent step code, all on a healthy page     | test issue, likely                                  |
| `TIMED_OUT` on a healthy page                                                      | undecided, likely                                   |
| a failed check after an `agent.act` the model carried out (not replayed)           | undecided, likely: the model may only claim it      |
| any other failed check on a healthy page                                           | app bug, likely                                     |

"The failing work" runs from the step after the last check that passed to the end of the step
that failed. The 5xx a verdict names is picked from the calls before that step ended: a route
that also answered 5xx in attempts that passed is noise and skipped, as is a server call that
failed only because one of its own calls was blocked; then a write during the failing work wins,
then any call during it, then a write before it, then any call before it, the latest first.
Emulator answers and faulted calls never count as the app's errors, and page assets are left out.
Treat a likely verdict as where to look first, not as proof.

## What the code says to do

| Code                                        | Look at                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOCATOR_NOT_FOUND`, `LOCATOR_AMBIGUOUS`    | the screen at failure and the nearest candidates; fix the locator with MCP `check_locator`                                                           |
| `EXPECTATION_FAILED`                        | expected vs received; is the app wrong, or the expectation?                                                                                          |
| `CLAIM_FAILED`                              | the judge's reason; the claim may be too strict or the app wrong                                                                                     |
| `APP_ERROR`                                 | the app's own 5xx or uncaught error during the step: an app bug                                                                                      |
| `PROVIDER_ERROR`                            | the provider call that failed (often a fault the matrix injected) and whether the app recovered; check the emulator state and webhook deliveries     |
| `STALE_RECORDING`, `NOTHING_RECORDED`       | the step's recording key changed or never existed: rerun `danwo test` to record, then the matrix                                                     |
| `REPLAY_MISSING`                            | under `--replay-only`, the step had no recording that replays; the message says none, stale or why it stopped matching: rerun without the flag       |
| `AGENT_LOOPING`, `BUDGET_EXCEEDED`          | the step instruction is too vague or the page changed; split the step or use locators                                                                |
| `MODEL_OUTPUT_INVALID`, `MODEL_UNAVAILABLE` | the model provider, not the app; retry or change model                                                                                               |
| `MODEL_REFUSED`                             | the model declined the step (a refusal or a content filter) and was not asked again; reword the step or run it on another model; the app is untested |
| `BROWSER_FAILED`, `ENVIRONMENT_FAILED`      | the browser or the environment hook: app start-up, emulators, ports; no Chromium: `npx @danwo/cli install-browser`                                   |
| `CONFIG_INVALID`                            | the config or the call named in the message                                                                                                          |
| `PACKAGE_MISSING`                           | an optional danwo package the command or config needs (`@danwo/mobile`, `@danwo/mcp`, `@danwo/recorder`); run the install the message names          |

`danwo spec --topic errors` lists every code with its class and exit code. `danwo cache ls`,
`stats` and `clear` show and reset recordings. `danwo doctor` (`--json` for a script) checks the
machine and the project before a run: Node, danwo's Chromium, the config and its keys, the
model's key, `@playwright/test`'s version and the skill copies, plus the device toolchain (and
Flutter for a `pubspec.yaml`) when the config uses `@danwo/mobile`'s device helpers, and last
which optional packages are installed: each line names the package, its version and the features
it enables, or the install command (a fail when the config needs it, a warning when the agents'
MCP config starts the server without `@danwo/mcp`).

## Proxy noise

The proxy prints nothing about the connections around a call: a browser dropping a stream or
socket as a page or test closes (`read ECONNRESET`, `EPIPE`), a client turning down its TLS
handshake (a device's own services, an app that does not trust danwo's CA), or a host it could not
reach (the call's 502 says why, in the run's record). Set `DANWO_DEBUG=proxy` (a comma-separated
list, or `*`) to see those lines when chasing a connection problem. A route's handler that throws
always prints, and its call gets a 500.

Protocols: ALPN picks HTTP/1.1 whenever the client offers it (browsers, most SDKs: nothing changes
for them), HTTP/2 when it offers `h2` alone (gRPC: grpc-js, grpcio, grpc-go, Google Cloud client
libraries, Temporal); a client offering neither is turned away with `no application protocol`.
Cleartext HTTP/2 (`h2c`, the `PRI * HTTP/2.0` preface) is taken on the plain port and inside a
CONNECT tunnel (gRPC to a plaintext target). Every HTTP/2 stream is one exchange through the same
pipeline as HTTP/1.1 (routes, `failNext`/`setFault`, blocked hosts, loop check, the record,
`settled()`); `:authority` stands for `Host`, and connection-specific headers never go out on
HTTP/2. Passthrough speaks HTTP/2 upstream when the server picks `h2` (one pooled session per
origin), streaming both ways with trailers and resets carried across; a server that picks
HTTP/1.1 gets the stream as an HTTP/1.1 request; a stream the server refuses (`REFUSED_STREAM`, as
on a session it is closing) goes once more on a fresh session with its body (kept up to 1 MiB while
unanswered), and a bodyless one whose reused session died under it goes once more too. A route's
handler gets a gRPC call over HTTP/2 (`application/grpc*`) streamed: `request.body` as the client
sends it, and a `Response` whose body is a stream goes out as it streams, so a handler can emulate
client, server and two-way streams; `withTrailers(response, () => ({ "grpc-status": "13" }))` (from
`@danwo/proxy`) sends trailers decided once the body has ended; without them a gRPC answer's
`grpc-status`/`grpc-message` headers go out as trailers (alone with the headers, trailers-only, when
the body is null). Every other call is still read and answered whole. A `status` or `reset` fault
answers a streamed call without its handler and lets its body go unread. Faults
on HTTP/2 hit one stream: `reset` and `reset-after` send `RST_STREAM` `INTERNAL_ERROR` (grpc-js:
`13 INTERNAL: Received RST_STREAM with code 2`), other streams on the session carry on; status and
delay faults answer as on HTTP/1.1. A 502 from the proxy reads as `UNAVAILABLE` in gRPC.
`application/grpc` answers count as streams, so readiness does not wait for them to end. Symptoms:
`certificate signed by unknown authority` from grpc-go on macOS/Windows (it ignores
`SSL_CERT_FILE` there; see `providers`, Apps in other languages); a gRPC app that sets
`grpc_proxy` itself overrides danwo's `https_proxy`.
