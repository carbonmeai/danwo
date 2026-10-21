## What and why

<!-- One change per pull request. Link the issue it closes, e.g. "Closes #12". -->

## Checklist

- [ ] The title follows Conventional Commits, e.g. `fix(emulators): Stripe refunds keep the charge's currency`
- [ ] Tests cover the change; a bug fix has a test that fails without it
- [ ] `bun run check` passes, and `bun run test:slow` if it touches the runner, proxy, emulators, CLI, dashboard or devices
- [ ] The guide in `packages/skill/guides` is updated if behaviour changed
