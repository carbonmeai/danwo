/**
 * Integration lint: rules that read what a run did behind the app (its provider calls, the
 * webhooks it answered, its steps) and flag risky provider usage, with no invariant to write.
 */
import type { ServiceDelivery } from "@danwo/matrix"

import type { RecordedExchange, RecordedStep } from "../runner/record.ts"
import type { SourceLine } from "../support/errors.ts"

export type LintSeverity = "error" | "warning" | "info"

/** What a finding points at: the call or delivery, and the step (with its test line) it came in. */
export interface LintEvidence {
  readonly exchange?: {
    readonly id: string
    readonly method: string
    readonly host: string
    readonly path: string
    readonly status: number | null
  }
  readonly delivery?: {
    readonly topic: string
    readonly attempt: number
    readonly status: number | null
    readonly fault: string | null
  }
  readonly step?: { readonly index: number; readonly label: string }
  readonly source?: SourceLine
}

/** One problem a rule found in one run. */
export interface LintFinding {
  readonly rule: string
  readonly severity: LintSeverity
  /** The provider the finding is about, e.g. `stripe`; `any` for rules about every provider. */
  readonly provider: string
  readonly message: string
  readonly hint: string
  /** Where to read more: a `danwo guide` topic and section. */
  readonly docs: string
  readonly evidence: LintEvidence
}

/** What the rules read: a run's flight record, or the same fields before it is written. */
export interface LintSubject {
  readonly run:
    | { readonly kind: "test"; readonly attempt: number }
    | { readonly kind: "matrix"; readonly fault: { readonly label: string } | null }
  readonly status: string
  /** A matrix run whose body stopped early; a body that ran to its end has none. */
  readonly stopped: string | undefined
  readonly steps: readonly RecordedStep[]
  readonly exchanges: readonly RecordedExchange[]
  readonly deliveries: readonly ServiceDelivery[]
}

/** What a rule reports before the engine adds its id, severity, hint and docs. */
export type RuleFinding = Pick<LintFinding, "provider" | "message" | "evidence">

export interface LintRule {
  /** `provider/what`, e.g. `stripe/idempotency-key`. */
  readonly id: string
  readonly severity: LintSeverity
  /** Providers the rule is about; it runs only when the run used one (`any`: always). */
  readonly providers: readonly string[]
  /** One line for `danwo spec` and the guide. */
  readonly summary: string
  /** What to change, shown with every finding. */
  readonly hint: string
  check(subject: LintSubject): readonly RuleFinding[]
}

/** A rule's level in the config: `warn` is `warning`; `off` turns it off. */
export type RuleLevel = "error" | "warn" | "info" | "off"

/** The config's `lint` section. */
export interface LintConfig {
  /** Per-rule levels, by id. */
  readonly rules?: Readonly<Record<string, RuleLevel>>
  /** Which findings fail the run: `error` findings, `warning` and worse, or none (the default). */
  readonly failOn?: "error" | "warning" | "never"
}
