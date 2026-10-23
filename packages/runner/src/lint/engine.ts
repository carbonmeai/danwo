/*
 * Runs the integration lint rules over a run, and says what came of them: findings with their
 * level, a summary line, detail lines, and whether they fail the run.
 */
import { counted } from "../support/counted.ts"
import { noRetryOnSerialization } from "./rules/data.ts"
import { duplicateMessage } from "./rules/messages.ts"
import { oauthPkce, oauthState } from "./rules/oauth.ts"
import { flutterwaveVerify, unconfirmedPayment } from "./rules/payments.ts"
import { duplicateCreate, noRetryOnRead, retryAfterIgnored } from "./rules/resilience.ts"
import { publishableKeyOnServer, secretKeyInBrowser, secretKeyInUrl } from "./rules/secrets.ts"
import { stripeIdempotencyKey } from "./rules/stripe.ts"
import {
  acceptsForgedWebhooks,
  acceptsStaleWebhooks,
  rejectsValidWebhooks,
  slowWebhookAnswer,
} from "./rules/webhooks.ts"
import { providersIn } from "./subject.ts"
import type {
  LintConfig,
  LintFinding,
  LintRule,
  LintSeverity,
  LintSubject,
  RuleLevel,
} from "./types.ts"

/** Every rule, in the order findings are reported. */
export const LINT_RULES: readonly LintRule[] = [
  acceptsForgedWebhooks,
  unconfirmedPayment,
  duplicateCreate,
  secretKeyInBrowser,
  secretKeyInUrl,
  stripeIdempotencyKey,
  flutterwaveVerify,
  acceptsStaleWebhooks,
  rejectsValidWebhooks,
  slowWebhookAnswer,
  retryAfterIgnored,
  oauthState,
  duplicateMessage,
  noRetryOnRead,
  oauthPkce,
  publishableKeyOnServer,
  noRetryOnSerialization,
]

const LEVELS: Readonly<Record<Exclude<RuleLevel, "off">, LintSeverity>> = {
  error: "error",
  warn: "warning",
  info: "info",
}

/** A rule's severity under the config, or undefined when the config turns it off. */
function severityOf(rule: LintRule, config: LintConfig | undefined): LintSeverity | undefined {
  const level = config?.rules?.[rule.id]

  if (level === undefined) return rule.severity

  return level === "off" ? undefined : LEVELS[level]
}

/** The `danwo guide lint` section a rule is explained in. */
function docsOf(rule: LintRule): string {
  return `danwo guide lint#${rule.id.replace("/", "-")}`
}

/** Every finding of every rule that applies to the run's providers and is not turned off. */
export function lint(subject: LintSubject, config?: LintConfig): LintFinding[] {
  const used = providersIn(subject)

  return LINT_RULES.flatMap((rule) => {
    const severity = severityOf(rule, config)

    if (severity === undefined) return []
    if (!rule.providers.includes("any") && !rule.providers.some((p) => used.has(p))) return []

    return rule
      .check(subject)
      .map((found) => ({ ...found, rule: rule.id, severity, hint: rule.hint, docs: docsOf(rule) }))
  })
}

const RANK: Readonly<Record<LintSeverity, number>> = { error: 0, warning: 1, info: 2 }

/** Whether the findings fail the run under `failOn` (by default, they never do). */
function lintFails(findings: readonly LintFinding[], config?: LintConfig): boolean {
  const failOn = config?.failOn ?? "never"

  if (failOn === "never") return false

  return findings.some((finding) => RANK[finding.severity] <= RANK[failOn])
}

/** `integration lint: 2 errors, 1 warning`; undefined when there is nothing to say. */
function lintSummary(findings: readonly LintFinding[]): string | undefined {
  if (findings.length === 0) return undefined

  const count = (severity: LintSeverity) => findings.filter((f) => f.severity === severity).length
  const parts = [
    count("error") > 0 && counted(count("error"), "error"),
    count("warning") > 0 && counted(count("warning"), "warning"),
    count("info") > 0 && `${count("info")} info`,
  ].filter((part) => part !== false)

  return `integration lint: ${parts.join(", ")}`
}

/** Where a finding happened, for a detail line: the test line, else the step, else the call. */
export function findingPlace(finding: LintFinding): string {
  const { source, step, exchange, delivery } = finding.evidence

  if (source !== undefined) return `${source.file}:${source.line}`
  if (step !== undefined) return `step ${step.index}`
  if (exchange !== undefined) return `${exchange.method} ${exchange.host}${exchange.path}`

  return delivery === undefined ? "" : `webhook ${delivery.topic}`
}

/**
 * The detail lines for findings, once per rule and place: a matrix runs the same test many times,
 * and the same finding from each run would only repeat itself.
 */
function lintLines(findings: readonly LintFinding[]): string[] {
  const seen = new Set<string>()
  const lines: string[] = []

  for (const finding of findings.toSorted((a, b) => RANK[a.severity] - RANK[b.severity])) {
    const key = `${finding.rule} ${finding.message}`

    if (seen.has(key)) continue
    seen.add(key)
    lines.push(
      `  ${finding.severity.padEnd(7)} ${finding.rule}  ${finding.message}`,
      `          at ${findingPlace(finding) || "the run"}; ${finding.hint}`,
    )
  }

  return lines
}

/** What a run prints about its findings: the summary line, then each finding. */
export function lintReport(findings: readonly LintFinding[]): string[] {
  const distinct = distinctFindings(findings)
  const summary = lintSummary(distinct)

  return summary === undefined ? [] : [summary, ...lintLines(distinct)]
}

/**
 * The exit code a run ends with once its findings are counted: a passing run fails (1) when its
 * findings reach the config's `failOn`; a failing run keeps its own code.
 */
export function withLint(
  code: number,
  findings: readonly LintFinding[],
  config: LintConfig | false | undefined,
): number {
  if (code !== 0 || config === false) return code

  return lintFails(findings, config) ? 1 : 0
}

/** Findings with duplicates (same rule and message) removed, for reports over many runs. */
export function distinctFindings(findings: readonly LintFinding[]): LintFinding[] {
  const seen = new Set<string>()

  return findings.filter((finding) => {
    const key = `${finding.rule} ${finding.message}`

    if (seen.has(key)) return false
    seen.add(key)

    return true
  })
}
