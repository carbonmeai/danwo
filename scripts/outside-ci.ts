/**
 * The slow tests' setup: every danwo they start runs as it would in a developer's terminal, wherever
 * the tests themselves run. A CI job's `CI` would give each of those runs CI's defaults (a retry, a
 * read-only replay cache, `.only` refused), and its `GITHUB_*` variables would point the GitHub
 * reporter at the job running the tests. A test about either sets the variables it wants itself.
 */
for (const name of Object.keys(process.env)) {
  if (name === "CI" || name.startsWith("GITHUB_")) delete process.env[name]
}
