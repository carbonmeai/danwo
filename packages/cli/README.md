# @danwo/cli

The `danwo` command. [dánwò](https://danwo.dev) is an open-source testing framework that drives
your app through its UI like a user, then checks everything that happened behind it: the payments,
webhooks, emails and database writes, against local emulators of the services the app calls.

Set it up in your app's folder (Node.js 24 or later):

```sh
npx @danwo/cli init
npx playwright-core install chromium
npm run test:danwo
```

`init` writes `danwo.config.ts`, an example test and a `test:danwo` script, and installs
`@danwo/cli` and `@danwo/sdk`. Then:

| Command               | What it does                                                         |
| --------------------- | -------------------------------------------------------------------- |
| `danwo test`          | Runs the `*.danwo.ts` tests in parallel workers.                     |
| `danwo matrix <file>` | Records one clean run, then replays it once per fault the app meets. |
| `danwo serve`         | Opens the dashboard: runs, flight records, matrix grids.             |
| `danwo record`        | Writes a test from what you do in a browser.                         |
| `danwo mcp`           | Serves the project to coding agents over MCP.                        |
| `danwo guide`         | Prints the guides, for you or a coding agent.                        |

`danwo --help` lists every command and option. Documentation: https://danwo.dev. Source:
https://github.com/danwo-dev/danwo. Licensed under the Apache License 2.0.
