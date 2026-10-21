# Security policy

## Reporting a vulnerability

Please do not report security problems in public issues, discussions or pull requests.

Report them privately through GitHub: open this repository's **Security** tab and choose **Report a vulnerability** ([new advisory](https://github.com/carbonmeai/danwo/security/advisories/new)). Include what you found, how to reproduce it, and what an attacker could do with it.

You will get an acknowledgement within three working days. We will keep you informed while we fix it, agree a disclosure date with you, and credit you in the advisory unless you would rather we didn't.

## Supported versions

danwo is early and not yet at 1.0. Fixes land on the latest release only.

## Scope

In scope: the danwo CLI, runner, egress proxy, emulators, dashboard, MCP server and GitHub reporter in this repository. Examples of what we care about:

- a secret (an API key, a password, a `secret()` value) reaching the model, a flight record, a report, a log or a pull request comment unredacted;
- the dashboard or MCP server accepting requests that let another site or process start runs, read records or execute commands;
- the egress proxy or its CA being usable beyond the test run that created it;
- an emulator or the proxy forwarding traffic to a real provider when it should not.

Out of scope: vulnerabilities in the apps you test with danwo, and in third-party services danwo emulates.
