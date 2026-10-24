# @danwo/cli

The `danwo` command. [dánwò](https://danwo.dev) is an open-source testing framework that drives
your app through its UI like a user, then checks everything that happened behind it: the payments,
webhooks, emails and database writes, against local emulators of the services the app calls.

Set it up in your app's folder (Node.js 22.22.3 or a later 22, or 24.11.1 or later):

```sh
npx @danwo/cli init
npx @danwo/cli install-browser
npm run test:danwo
```

`init` writes `danwo.config.ts`, an example test and a `test:danwo` script, and installs
`@danwo/cli` and `@danwo/sdk` at its own version (`danwo --version` prints it), plus
`@types/node` in a TypeScript project that lacks it. Install Chromium with `playwright-core` as
above, not `npx playwright install`, whose browser may not match. Then:

| Command               | What it does                                                         |
| --------------------- | -------------------------------------------------------------------- |
| `danwo test`          | Runs the `*.danwo.ts` tests in parallel workers.                     |
| `danwo matrix <file>` | Records one clean run, then replays it once per fault the app meets. |
| `danwo serve`         | Opens the dashboard: runs, flight records, matrix grids.             |
| `danwo record`        | Writes a test from what you do in a browser.                         |
| `danwo mcp`           | Serves the project to coding agents over MCP.                        |
| `danwo device doctor` | Checks this machine for Android and iOS tests.                       |
| `danwo guide`         | Prints the guides, for you or a coding agent.                        |

The CLI keeps a web project small: the packages only some features need are optional peers,
which `init` adds when your answers call for them, at the CLI's version.

| Package           | Needed for                                                       | Added by `init` for |
| ----------------- | ---------------------------------------------------------------- | ------------------- |
| `@danwo/mobile`   | mobile tests, `danwo device`, `danwo build-android`, `build-ios` | a mobile engine     |
| `@danwo/mcp`      | `danwo mcp`, the MCP server coding agents start                  | coding agents       |
| `@danwo/recorder` | `danwo record`, and the MCP server's recording tools             | coding agents       |

A command that needs one you lack says how to add it, such as
`danwo build-ios needs @danwo/mobile: npm install -D @danwo/mobile@<version>`, and
`danwo doctor` lists which ones are installed.

`danwo --help` lists every command and option. Documentation: https://danwo.dev. Source:
https://github.com/carbonmeai/danwo. Licensed under the Apache License 2.0.
