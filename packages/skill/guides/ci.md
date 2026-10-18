# CI and the GitHub check

Run danwo in GitHub Actions and get a check run on the pull request, with an annotation on each
failing test line.

```yaml
permissions:
  checks: write
  contents: read

jobs:
  danwo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx danwo test --reporter github
        env:
          GITHUB_TOKEN: ${{ github.token }}
      - run: npx danwo matrix tests/checkout.danwo.ts --reporter github
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
- Commit the replay cache (`cache.dir`) so CI replays recorded agent steps without model calls;
  give CI a model key only if recordings may be missing.
- Narrow the matrix in pull requests with `--faults` and run it in full on a schedule.
- Exit codes: 1 a test failed, 2 configuration, 3 infrastructure (browser, environment, model
  provider), 130 interrupted.
