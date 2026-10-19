# Contributing to danwo

Thanks for helping. This guide covers setting up, the checks a change must pass, and the conventions the code follows.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Setting up

You need Node 24 and bun 1.3 or later. Android work also needs the Android SDK (`danwo device check` says what is missing), and the Postgres and Redis tests need Docker.

```bash
bun install
bun run check       # format, plain-JS gate, lint, fallow, typecheck, unit tests
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
| `website/`                                          | The website and docs, generated from `packages/skill/guides`               |
| `examples/`                                         | Example apps the tests run against                                         |

## Making a change

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Keep each pull request to one change, with tests. A bug fix comes with a test that fails without it.
3. Run `bun run check` before pushing, and `bun run test:slow` if you touched the runner, proxy, emulators, CLI, dashboard or devices.
4. Update the guide in `packages/skill/guides` when behaviour changes. The docs site is built from those files, so there is one place to edit.

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

## Licence

danwo is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution you agree that it is licensed under the same terms, as section 5 of the licence describes. The dánwò name and logos are covered by [TRADEMARKS.md](TRADEMARKS.md), not the code licence.
