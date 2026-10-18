## danwo benchmark · 2026-10-18 · anthropic/claude-sonnet-5.5

| Style | Pass rate | Not expressible | False failures | Bugs caught | Model calls | Cost | Time / test | Replay calls |
|---|---|---|---|---|---|---|---|---|
| locators | 100% (10/10) | 1 | 0 | 100% (4/4) | 0 | $0.0000 | 1695 ms | – |
| agent | 100% (11/11) | 0 | 0 | 100% (4/4) | 60 | $0.3979 | 12803 ms | 0 (11 passed) |
| mixed | 100% (11/11) | 0 | 0 | 100% (4/4) | 40 | $0.3238 | 8478 ms | 0 (11 passed) |

### danwo matrix on provider bugs: 100% caught (5/5), 0 false failures on the correct app

| Bug | Result | How |
|---|---|---|
| no-dedupe | caught | 1 faulted run(s) failed |
| no-idempotency | caught | 1 faulted run(s) failed and 1 lint error(s) |
| fulfil-on-redirect | caught | 1 faulted run(s) failed |
| no-verify | caught | 1 lint error(s) |
| raw-429 | caught | 1 faulted run(s) failed |

Wall time: 720 s
