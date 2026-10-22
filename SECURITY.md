# Security policy

## Reporting a vulnerability

Please do not report security problems in public issues, discussions or pull requests.

Report them privately through GitHub: open this repository's **Security** tab and choose **Report a vulnerability** ([new advisory](https://github.com/carbonmeai/danwo/security/advisories/new)). Include what you found, how to reproduce it, and what an attacker could do with it.

You will get an acknowledgement within three working days. We will keep you informed while we fix it, agree a disclosure date with you, and credit you in the advisory unless you would rather we didn't.

## Supported versions

danwo is early and not yet at 1.0. Fixes land on the latest release only.

## How dependencies are scanned

The `Security` workflow scans `bun.lock` on every pull request that changes a `package.json` or a lockfile, on every push to main, and weekly:

- `bun audit` is the gate. It fails on a high or critical advisory unless the advisory is in [`.github/vulnerability-allowlist.json`](.github/vulnerability-allowlist.json). Run it locally with `bun run audit`.
- OSV-Scanner reads every lockfile in the repository and uploads what it finds to the Security tab.
- CodeQL (`codeql.yml`) analyses the TypeScript source on pull requests to main, on pushes to main and weekly.

An advisory goes on the allowlist only when the vulnerable code cannot be reached from danwo and no fixed version fits the dependency's range. Each entry says why, and has a review-by date about three months out; a unit test fails once that date passes, so every exception is looked at again. Dependabot opens the security fixes it can make as one grouped pull request.

## Known advisories in what you install

These are advisories a scanner may report in `@danwo/*` packages installed from npm, where the vulnerable code cannot be reached from danwo and no fix fits the dependency's range yet.

- **basic-ftp, [GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r) (high).** It arrives through `@danwo/proxy > mockttp > pac-proxy-agent > get-uri > basic-ftp`. The bug is a CPU denial of service in `Client.list()` while it parses a hostile FTP server's directory listing. basic-ftp runs only when get-uri fetches an `ftp:` URL, and get-uri is used only to fetch a PAC file for an upstream proxy. danwo's proxy never sets an upstream proxy or a PAC file, so this code never loads. The fix (basic-ftp 6.2.1 and later) is outside every get-uri 6 release's range, which is the line mockttp uses. This repository overrides basic-ftp to `^6.2.3`, but an override does not reach your install. If your own policy needs it gone, add the same override (`overrides` in npm and Bun, `pnpm.overrides` in pnpm, `resolutions` in Yarn).

## Scope

In scope: the danwo CLI, runner, egress proxy, emulators, dashboard, MCP server and GitHub reporter in this repository. Examples of what we care about:

- a secret (an API key, a password, a `secret()` value) reaching the model, a flight record, a report, a log or a pull request comment unredacted;
- the dashboard or MCP server accepting requests that let another site or process start runs, read records or execute commands;
- the egress proxy or its CA being usable beyond the test run that created it;
- an emulator or the proxy forwarding traffic to a real provider when it should not.

Out of scope: vulnerabilities in the apps you test with danwo, and in third-party services danwo emulates.
