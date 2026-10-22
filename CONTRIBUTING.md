# Contributing to danwo

Thanks for helping. This guide covers setting up, the checks a change must pass, and the conventions the code follows.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Setting up

You need Node 22.22.3 or a later 22, or 24.11.1 or later (CI runs both), and bun 1.3 or later. Android work also needs the Android SDK (`danwo device check` says what is missing), and the Postgres and Redis tests need Docker.

```bash
bun install
bun run check       # format, plain-JS gate, lint, fallow, typecheck, declarations, unit tests
bun run test:slow   # browser, CLI, matrix and device tests
```

Keys for the live fidelity checks go in `.env.fidelity` (git-ignored). Use test or sandbox keys only.

## Repository layout

| Path                                                | What it is                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/sdk`                                      | The public API tests import (`@danwo/sdk`)                                 |
| `packages/cli`                                      | The `danwo` command                                                        |
| `packages/runner`                                   | Workers, the agent, recording, isolation, environments                     |
| `packages/matrix`                                   | Fault planning and judging                                                 |
| `packages/proxy`                                    | The egress proxy and its preload                                           |
| `packages/emulators`                                | Every provider emulator                                                    |
| `packages/infra`, `packages/data`                   | Postgres and Redis fault proxies, data snapshots                           |
| `packages/fidelity`                                 | Checks of the emulators against the real APIs, with goldens in `fidelity/` |
| `packages/dashboard`, `packages/ui`                 | `danwo serve` and the component library it is built from                   |
| `packages/github`, `packages/mcp`, `packages/skill` | The GitHub reporter, the MCP server, the coding-agent skill and guides     |
| `packages/device`, `packages/expo`                  | Android devices and Expo builds                                            |
| `website/`                                          | The website: hand-written docs in `content/docs`, and the changelog        |
| `examples/`                                         | Example apps: workspaces the tests run against, and standalone starters    |
| `scripts/`                                          | The declarations build, the release script and repository checks           |

## Making a change

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Keep each pull request to one change, with tests. A bug fix comes with a test that fails without it.
3. Run `bun run check` before pushing, and `bun run test:slow` if you touched the runner, proxy, emulators, CLI, dashboard or devices.
4. Update the docs when behaviour changes, in both places: the guide in `packages/skill/guides` (dense, for coding agents) and the page in `website/content/docs` (written for people, following `website/DOCS_STYLE.md`). Add a line to `website/content/changelog/unreleased.mdx` for anything a user would notice.

## Conventions

- **TypeScript only.** No plain JavaScript files apart from the few `.mjs` entry points the plain-JS gate allows.
- **Comments are JSDoc** (`/** */`), for declarations and multi-line notes. Say why, not what.
- **Lint and fallow are strict.** oxlint runs with `--deny-warnings`, and fallow checks dead code, duplication and complexity with no baselines. Split a function rather than silence a rule.
- **UI uses `@danwo/ui`.** Dashboard and website controls come from the component library; a test fails on raw buttons, selects, inputs and tables.
- **Tests leave nothing behind.** Tests run on throwaway copies of examples and fixtures, and the run fails if a process or file is left over.
- **Commits follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)**: `type(scope): description`, with the package as the scope, e.g. `fix(emulators): Stripe refunds keep the charge's currency`.

## Adding or changing an emulator

An emulator should answer as the real API does, so an app's own SDK works against it unchanged.

- Follow the layout of an existing one (`packages/emulators/src/stripe` is the fullest): entities, store, formatters, routes, events, faults and a seed config.
- Give it a fault catalogue with error bodies the provider's SDK parses, and register its hosts in the runner's default catalogue.
- Make reset and restore complete; the isolation conformance test covers every emulator.
- Add fidelity scenarios in `packages/fidelity`, and run them live against a test account before refreshing the golden (`danwo fidelity <provider> --update-golden`). Goldens hold response structure only, never ids or personal data.

## Examples

`examples/shop`, `shop-playwright` and `shop-mobile` are workspaces of this repository: they run against the packages' source, and the slow tests and the Dogfood workflow use them.

The other examples are standalone, as a user's project would be, and pin a danwo version in their `package.json`. Each has an `example.json` (its name, stack, providers and the test to show), which the website's examples gallery is built from. They share the look in `examples/_kit`; `node examples/_kit/sync.ts` copies it into each example's `kit/`, and a unit test fails when a copy drifts. Until the pinned version is on npm, install an example from local tarballs:

```bash
bun run release <version> --pack           # writes dist/release/*.tgz
node examples/link.ts with-next            # a copy in a temporary folder; prints its path last
node examples/link.ts with-next --here     # or in place, so your editor finds the types
```

`--here` puts the example's `package.json` back afterwards and leaves only the git-ignored `node_modules` behind.

## CI

| Workflow       | What it runs                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `ci.yml`       | `bun run check` and gitleaks, on every pull request and push to main                                       |
| `slow.yml`     | `bun run test:slow` in four shards, nightly and by hand                                                    |
| `dogfood.yml`  | `examples/shop`'s tests and matrix on pull requests, reported as a check and a comment                     |
| `examples.yml` | each standalone example installed from the release tarballs: its tests, then its matrix with `--budget 10` |
| `release.yml`  | the release, on a `v*` tag (see below)                                                                     |
| `security.yml` | `bun audit` against the allowlist, and OSV-Scanner to the Security tab, on dependency changes and weekly   |
| `codeql.yml`   | CodeQL over the TypeScript source, on pull requests to main, pushes to main and weekly                     |

`examples.yml` runs nightly and by hand on every example whose `example.json` says `"install": "npm"`, so a new example needs no change there. On a pull request it runs only the examples it changed, or all of them when it changed `examples/_kit`, `examples/link.ts` or the workflow. The ruleset requires its `examples gate` job alone, which passes when every example passed or was skipped.

## Releasing

All public packages are released together, at one version. `@danwo/ui` and `@danwo/fidelity` stay private. Check a release locally first:

```bash
bun run release 0.1.0-beta.0 --pack --verify
```

`--pack` builds the dashboard and the type declarations, stages each public package at the version (every `workspace:` range replaced) and writes one tarball per package to `dist/release`. `--verify` installs the tarballs into a fresh npm project, runs `danwo --version`, `init`, `test` and a strict `tsc` there, and fails if danwo left anything running. The script refuses a dirty tree and a version that is not semver.

To publish, push a `v*` tag for the version, such as `v0.1.0-beta.0`. `release.yml` then:

1. runs `bun run check` and the same `--pack --verify`;
2. waits in the `npm` environment until a required reviewer approves it (**Settings > Environments > npm**);
3. publishes with provenance through trusted publishing, dependencies first, under `beta` for a prerelease and `latest` otherwise;
4. creates the GitHub release, with notes from the commits since the last tag.

It can also be started by hand from the Actions tab with a version.

### A package's first publish

npm lets a package have a trusted publisher only once it exists, so each package is published the first time by hand, with 2FA. Never publish from a package's folder: that sends version 0.0.0 with `workspace:*` dependencies. Run `bun run release <version> --pack --verify`, then publish the tarballs in the order it lists them, dependencies first:

```bash
npm publish dist/release/<tarball>.tgz --access public --tag beta
```

Then, on the package's **Settings** page on npmjs.com, under **Trusted publishing**, add a GitHub Actions publisher:

| Field                | Value         |
| -------------------- | ------------- |
| Organization or user | `carbonmeai`  |
| Repository           | `danwo`       |
| Workflow filename    | `release.yml` |
| Environment name     | `npm`         |

Once it has published from CI, set **Publishing access** to require 2FA and disallow tokens. A package added later needs the same: one manual publish, then its trusted publisher.

## Licence

danwo is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution you agree that it is licensed under the same terms, as section 5 of the licence describes. The dánwò name and logos are covered by [TRADEMARKS.md](TRADEMARKS.md), not the code licence.
