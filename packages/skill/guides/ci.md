# CI, the GitHub check and the pull request comment

Run danwo in GitHub Actions and get a check run on the pull request, with an annotation on each
failing test line, and one comment on the pull request that every run keeps up to date.

```yaml
permissions:
  checks: write
  pull-requests: write
  contents: read

jobs:
  danwo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npx @danwo/cli install-browser --with-deps --only-shell
      - run: npx @danwo/cli test --reporter github
        env:
          GITHUB_TOKEN: ${{ github.token }}
      - run: npx @danwo/cli matrix tests/checkout.danwo.ts --reporter github
        if: ${{ !cancelled() }}
        env:
          GITHUB_TOKEN: ${{ github.token }}
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: danwo-runs
          path: .danwo/runs
```

- The check carries pass/fail counts and a row per failing test or fault; the same summary goes
  to the job summary, and it names each failure's flight record in the uploaded artifact.
- Without a token, or when the token may not write checks, the reporter says so and the run's
  exit code is unchanged.

## The pull request comment

On a `pull_request` event the github reporter also posts one comment on the pull request and edits
it on every later run, so the conversation never fills with copies. It has:

- `danwo test`'s headline (passed, failed, flaky, not judged), duration, model spend and commit;
- a row per test with its duration and retries, failures first; each test name links to
  `DANWO_REPORT_URL` when the report or dashboard is published there;
- each failure folded: the failing step, the error and its class, the last provider calls and any
  faults injected into them, and its flight record in the uploaded artifact;
- flaky tests folded away;
- a section per `danwo matrix` test: whether its invariant held under every fault, and a row per
  fault that broke it.

A run replaces its own section and keeps the others for the same commit; sections from an older
commit are dropped. A shard (`--shard i/n`) leaves the comment alone and `danwo merge-reports`
posts the whole run once. The comment stays under GitHub's size limit, cut between entries with a
note.

Turn it off with `--no-pr-comment`, `DANWO_PR_COMMENT=off`, or `github({ prComment: false })` in
the config. Without `pull-requests: write` the reporter says so once and keeps the check.

- Commit the replay cache (`cache.dir`) so CI replays recorded agent steps without model calls;
  give CI a model key only if recordings may be missing, or run `--replay-only` to fail a missing
  recording instead.
- Narrow the matrix in pull requests with `--faults` and run it in full on a schedule.
- Exit codes: 1 a test failed or could not be judged (a matrix trial that is invalid or not
  judged counts), 2 configuration, 3 infrastructure (browser, environment, model
  provider), 130 interrupted.

## Replay-only runs

`danwo test --replay-only` (or `cache: { dir, replayOnly: true }` in the config) replays agent
steps from the cache and calls no model at all, not even the judge. A step with no recording that
replays (none, a stale one, or one that no longer matches the page) fails with `REPLAY_MISSING`
(class `blocked`, exit 1) and its message says which and why; an `agent.assert` whose claim has no
recorded evidence (a claim of absence) fails the same way. The cache is read-only, and the summary
always prints `model: 0 calls (replay-only)`. It needs `cache.dir` (exit 2 without). Use it for a CI
gate that must spend no tokens; record a failing step by running it locally without the flag and
commit the cache.

## CI defaults

With `CI` set (every hosted CI sets it), or `--ci`, `danwo test` retries a failing test once, reads
the replay cache without writing to it, and refuses `.only` with exit 2, naming the file and line.
The config's `retries` and `--retries` still win. `--no-ci` (or `CI=false`/`CI=0` in its
environment) keeps the local defaults with `CI` set: for a `danwo test` started from inside
another run, such as a fixture that makes runs for a dashboard to show, which would otherwise
inherit the job's `CI=true`. `--max-failures n` starts no new test file once
`n` tests failed. `--max-duration <time>` (`20m`, `90s`, `1h`, `500ms`; a bare number is seconds)
starts no new test file once the run has taken that long; files already running finish, the run
prints `stopped at --max-duration (…): N test files not run` and exits at least 1, since those
files were never judged. Workers take whole files by default; `--split-files` (config `splitFiles:
true`) hands them single tests of every file whose tests share nothing (no `beforeAll`/`afterAll`
in the file, and each test on `isolation: "test"`, so it restores the seeded state anyway), so a
slow file no longer holds one worker. Files with file-level hooks or `isolation: "file"`/`"none"`
still run whole, in one worker, in order. Each split test loads its file afresh (as a retry does),
so module-level variables are not shared between its tests, and a session is signed in once per
worker that needs it. With splitting, the stop lines count tests: `N tests not run`. In CI, `npx @danwo/cli install-browser --with-deps --only-shell` installs
only the headless shell test runs use. `danwo doctor [--json]` checks, without running anything:
Node >= 24, that danwo's Chromium starts, that the config loads and has no unknown keys, the
model's key variable (`AI_GATEWAY_API_KEY` for a gateway id, the provider's own for an AI SDK
model), an installed `@playwright/test` against `@danwo/playwright`'s range, and that each
`SKILL.md` copy is this danwo's. It prints `ok|warn|fail  name: detail` lines (JSON
`{ ok, checks: [{ name, status, detail }] }`) and exits 1 on any `fail`.

## Flaky tests and reruns

A test that fails and then passes on a retry is flaky: it passes the run, and the summary, the
GitHub check (a warning annotation) and `danwo show --format md` all say so. `danwo test
--last-failed` reruns only what failed in the latest run and merges into it, so a test that failed
there and passes now is reported once, as flaky.

## Sharding

Split the suite across machines with `--shard i/n`; each machine runs every `n`th test file and
keeps its results in `.danwo/results/`. Gather those files on one machine and join them:

```yaml
- run: npx @danwo/cli test --shard ${{ matrix.shard }}/4
- uses: actions/upload-artifact@v4
  with: { name: "results-${{ matrix.shard }}", path: .danwo/results }
# in a later job, after downloading every results-* artifact into .danwo/results:
- run: npx @danwo/cli merge-reports --reporter github
```

`--reporter junit` writes `.danwo/junit.xml` for GitLab, Jenkins, CircleCI or Buildkite.

## Only the tests a change affects

`danwo test --changed --since origin/main` runs the tests the change can affect. A test is
selected when the change touches its file or a file it imports; for the app's own source, map
globs to what tests touch in the config:

```ts
impact: {
  rules: {
    "src/billing/**": ["api.stripe.com"],
    "app/routes/checkout/**": ["/checkout"],
    "src/webhooks.ts": ["webhook checkout.session.completed"],
  },
}
```

Every passing test records the pages it visited and the provider calls and webhooks behind it in
`.danwo/impact.json` (sorted, no timestamps or secrets; commit it with `!.danwo/impact.json` in
`.gitignore` so CI has it). A change nothing explains (a lockfile, the config, an unmapped file)
runs everything; Markdown and `docs/` run nothing. `danwo impact <files…>` explains a selection,
and names the `danwo matrix` runs worth doing for selected tests with an invariant.
