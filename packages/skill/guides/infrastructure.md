# Faults in the app's own database and cache

`danwo matrix` can break the app's own Postgres and Redis calls as well as its provider calls:
a COMMIT whose reply never arrived, a serialization failure, a database that is down for three
seconds, a cache that answers OOM. The app connects through a fault proxy instead of straight to
the server, and the matrix plans faults on the statements and commands its tests sent.

## Wiring it

Start a proxy in front of each store, give the app the proxy's URL, and list the proxies under
`data`:

```ts
import {
  defineConfig,
  postgresSnapshot,
  postgresWorkerDatabase,
  startApp,
  startPostgresProxy,
  startRedisProxy,
  stripeEnvironment,
} from "@danwo/sdk"

export default defineConfig({
  async environment({ workerIndex }) {
    const url = await postgresWorkerDatabase(process.env.DATABASE_URL ?? "", workerIndex)
    const postgres = await startPostgresProxy({ upstream: url })
    const cache = await startRedisProxy({ upstream: process.env.REDIS_URL ?? "", service: "cache" })
    const db = postgresSnapshot({ url })
    const stripe = await stripeEnvironment()
    const app = await startApp(
      { command: "npm run dev", url: "http://localhost:3000" },
      {
        ...stripe.proxy.env(),
        DATABASE_URL: postgres.url(url),
        REDIS_URL: cache.url(process.env.REDIS_URL ?? ""),
      },
    )

    return {
      baseUrl: app.url,
      proxy: stripe.proxy,
      data: [postgres, cache],
      // …reset, snapshot, restore and close as in `danwo guide matrix`
    }
  },
})
```

`proxy.url(realUrl)` swaps the host and port for the proxy's and keeps the user, password,
database and options. Snapshots and restores keep using the real URL. Each worker gets its own
proxies, like its own app. `service` names a proxy in labels (default `postgres` or `redis`).

## What the proxy sees

**Postgres:** the frontend/backend wire protocol, simple and extended queries alike. A call is one
Query, or the Parse/Bind/Execute messages up to a Sync, so pipelined drivers work. Each call is
labelled by its statement: `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `INSERT orders`,
`UPDATE stock`, `DELETE sessions`, `SELECT orders`. `WITH … UPDATE` reads as the UPDATE.
Row-locking clauses (`FOR UPDATE SKIP LOCKED`, `FOR NO KEY UPDATE OF t NOWAIT`, `FOR SHARE`)
are ignored when looking for the write, so a job-claim query such as `WITH next AS (SELECT …
FOR UPDATE SKIP LOCKED) UPDATE jobs …` reads as `UPDATE jobs`. The
table is read from the SQL text on a best-effort basis: its last name part, unquoted, in lower
case. Startup, authentication, COPY data, notices and notifications pass through untouched.

**Redis:** RESP2 and RESP3 commands, inline commands and pipelines. A command is labelled by its
verb and key, with parts that name one record folded to `*`: `INCR rate:login:*`,
`GET session:*`. MULTI/EXEC is tracked, so the commands inside are marked `inTransaction`. RESP3
push messages pass through. A connection that SUBSCRIBEs is passed through untouched from then
on.

**Roles:**

- `write`: INSERT/UPDATE/DELETE/MERGE, SET/INCR/EXPIRE/DEL…;
- `boundary`: BEGIN/COMMIT/ROLLBACK, EXEC;
- `read`: SELECT from a table, GET/HGET…;
- `other`: the driver's housekeeping (`SET search_path`, `SELECT 1`, PING, HELLO, SELECT). The
  matrix never faults these.

## Fault kinds and labels

Labels read `<fault> on <operation>[ #n] (<service>)`:

| Fault                                                  | Label                                               | What the app sees                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `{ kind: "reset" }`                                    | `reset on INSERT orders (postgres)`                 | the connection drops before the server sees the call                                                                             |
| `{ kind: "reset-after" }`                              | `reset-after on COMMIT (postgres)`                  | the server runs the call, then the connection drops before the reply. On COMMIT the data is committed and the app cannot know it |
| `{ kind: "delay", ms }`                                | `delay 5000ms on UPDATE stock (postgres)`           | the call reaches the server `ms` late, which acts as a timeout for clients that set one                                          |
| `pgError("serialization_failure")`                     | `serialization_failure on UPDATE orders (postgres)` | an ErrorResponse with SQLSTATE 40001                                                                                             |
| `pgError("deadlock_detected")`                         | `deadlock_detected on INSERT orders (postgres)`     | 40P01                                                                                                                            |
| `{ kind: "down", ms }`                                 | `down 3000ms on BEGIN (postgres)`                   | the connection drops, and new connections are refused for `ms`                                                                   |
| `{ kind: "down", ms, refuse: "too-many-connections" }` | `too_many_connections 3000ms on BEGIN (postgres)`   | as `down`, but each new connection gets FATAL 53300                                                                              |
| `redisError("OOM" \| "LOADING" \| "READONLY")`         | `OOM on INCR rate:login:* (cache)`                  | `-OOM …`, `-LOADING …` or `-READONLY …` in place of the reply                                                                    |

An injected Postgres error inside a transaction also fails the server's transaction, so later
statements meet `25P02` until the app rolls back, as with a real error. An injected error on
COMMIT rolls the transaction back.

By default (`defaultDataFaults`):

- a write gets reset, reset-after, delay 5000ms, serialization_failure and deadlock_detected;
- a COMMIT gets reset, reset-after and serialization_failure;
- a BEGIN gets down and too_many_connections for 3000ms;
- a Redis write or EXEC gets reset, reset-after, delay 5000ms, OOM and READONLY;
- a Redis read gets reset and LOADING.

`matrix.dataFaults: (call) => DataFault[]` replaces this list.

## Planning

Faults are planned from the clean run's data calls, by service, operation and occurrence
(`COMMIT #2` is the second COMMIT), and only on the calls the test itself caused. Calls made
while the environment reset or restored come before the trial starts and are not planned on.
The same read three or more times in a row is a poll and gets faults on its first call only
(` (poll)`). A trial whose data fault fired on no call is INVALID ("no database or cache call
matched"). `--faults "\(postgres\)"` runs only the Postgres faults, and `--faults "COMMIT"` only
those on COMMITs.

Data faults show up by label and verdict wherever other faults do: the matrix report, the
history the dashboard reads, JUnit and the GitHub check. Each trial's flight record also keeps
its calls (`dataCalls`, and "Database and cache calls" in the HTML report). The lint rule
`data/no-retry-on-serialization` flags a transaction that was given up after 40001 or 40P01.

## What a correct app does

- **Ambiguous commit:** after `reset-after on COMMIT` the app cannot tell whether the order was
  saved. Make the retry safe: give the work a key (a checkout id) and insert with
  `ON CONFLICT (key) DO NOTHING`. Send the same key as the provider's Idempotency-Key.
- **40001 / 40P01:** roll back and run the whole transaction again, a few times with backoff.
- **Database down or full:** retry the connection with backoff for a few seconds, then say so.
- **Cache errors:** decide whether to fail open or closed. A rate limiter that lets a request
  through when Redis answers OOM lets every request through.

## Limits

- TLS between the app and the store is declined (Postgres `sslmode=disable` or `prefer`; no
  `rediss://`). The proxy listens on 127.0.0.1.
- Statement classification reads the SQL text, not a parse: unusual statements (`CALL`, `DO`,
  `LOCK`) are `other` and not faulted.
- A faulted extended-protocol call is held until its Sync, even when the driver flushes earlier.
- Errors injected on commands queued inside MULTI answer the command, not the EXEC.
- MySQL is not supported.
