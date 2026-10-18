/**
 * The spec's sections that come from tables in the code rather than from declarations: the fault
 * vocabulary (planned the way `danwo matrix` plans it), error codes, cache outcomes and commands.
 */
import { planFaults, type RunOutcome, type ServiceDelivery } from "@danwo/core"
import type { Exchange } from "@danwo/proxy"
import {
  CACHE_OUTCOMES,
  DEFAULT_WEBHOOK_FAULTS,
  defaultOutboundFaults,
  errorCodeTable,
  FAULT_FORMS,
} from "@danwo/runner/runner"

import type { CliCommand, SpecEntry, SpecSection } from "./model.ts"
import { SOURCES } from "./sections.ts"
import type { SourceIndex } from "./source.ts"

/** One provider call the vocabulary is shown for; its faults come from the provider's catalogue. */
interface Probe {
  readonly provider: string
  readonly method: string
  readonly host: string
  readonly path: string
}

/** A write and, where reads fault differently, a read for each provider. */
const PROBES: readonly Probe[] = [
  { provider: "Stripe", method: "POST", host: "api.stripe.com", path: "/v1/checkout/sessions" },
  { provider: "Stripe", method: "GET", host: "api.stripe.com", path: "/v1/customers/cus_a1" },
  { provider: "Resend", method: "POST", host: "api.resend.com", path: "/emails" },
  { provider: "S3 and Tigris", method: "PUT", host: "t3.storage.dev", path: "/media/a.png" },
  { provider: "S3 and Tigris", method: "GET", host: "t3.storage.dev", path: "/media/a.png" },
  { provider: "Google", method: "POST", host: "oauth2.googleapis.com", path: "/token" },
  {
    provider: "Google",
    method: "GET",
    host: "gmail.googleapis.com",
    path: "/gmail/v1/users/me/history",
  },
  {
    provider: "Microsoft",
    method: "POST",
    host: "login.microsoftonline.com",
    path: "/common/oauth2/v2.0/token",
  },
  { provider: "Microsoft", method: "GET", host: "graph.microsoft.com", path: "/v1.0/me/messages" },
  { provider: "Slack", method: "POST", host: "slack.com", path: "/api/chat.postMessage" },
  {
    provider: "GitHub",
    method: "POST",
    host: "api.github.com",
    path: "/repos/acme/app/issues/1/comments",
  },
  { provider: "any other host", method: "POST", host: "api.example.test", path: "/v1/orders" },
]

/** Webhook deliveries the vocabulary is shown for: one unnamed sender, one named service. */
const DELIVERIES: readonly (readonly [string | undefined, string])[] = [
  [undefined, "checkout.session.completed"],
  ["slack", "events:A0APP"],
]

function exchange(probe: Probe, index: number): Exchange {
  return {
    disposition: "routed",
    method: probe.method,
    host: probe.host,
    path: probe.path,
    startedAt: new Date(0).toISOString(),
    id: String(index),
    fault: null,
    status: 200,
    durationMs: 0,
    aborted: false,
  }
}

function delivery([service, topic]: readonly [string | undefined, string], index: number) {
  const attempt: ServiceDelivery = {
    messageId: index,
    topic,
    endpointId: "endpoint",
    attempt: 1,
    at: new Date(0).toISOString(),
    status: 200,
    error: null,
    durationMs: 0,
    delivered: true,
    fault: null,
    ...(service !== undefined && { service }),
  }

  return attempt
}

/** The fault labels `danwo matrix` plans for each probe call and delivery, grouped by target. */
export function faultSection(index: SourceIndex): SpecSection {
  const clean: RunOutcome = {
    fault: null,
    status: "passed",
    error: null,
    exchanges: PROBES.map(exchange),
    deliveries: DELIVERIES.map(delivery),
    notes: [],
  }
  const plan = planFaults(clean, defaultOutboundFaults, DEFAULT_WEBHOOK_FAULTS)
  const groups = new Map<string, string[]>()

  for (const fault of plan) {
    const [what = fault.label, target = ""] = fault.label.split(" on ")

    groups.set(target, [...(groups.get(target) ?? []), what])
  }

  const providers = new Map(PROBES.map((probe) => [`${probe.method} ${probe.host}`, probe]))
  const entries: SpecEntry[] = [...groups].map(([target, faults]) => {
    const webhook = /^(?:(\S+) )?webhook /.exec(target)

    return {
      name: target,
      kind: webhook ? "webhook" : "outbound",
      signature: faults.join(" · "),
      doc: webhook
        ? `A webhook ${webhook[1] === undefined ? "from a sender that names no service, as Stripe's" : `from the ${webhook[1]} service`}; each delivery of the clean run gets these.`
        : `${providers.get(target.split("/")[0] ?? "")?.provider ?? ""} call.`,
      members: [],
    }
  })
  const forms: SpecEntry = {
    name: "label forms",
    kind: "grammar",
    signature: "",
    doc: "How fault labels read, for `danwo matrix --faults`, MCP `inject_fault` and `danwo.inject`.",
    members: FAULT_FORMS.map((form) => ({
      name: form.split(" ")[0] ?? form,
      signature: form,
      doc: "",
    })),
  }

  return {
    topic: "faults",
    title: "Fault vocabulary",
    about:
      "The faults `danwo matrix` plans: each provider call of the clean run × its provider's catalogue, and each webhook delivery × the webhook faults. Ids in paths read as `:id`; `#n` marks the n-th matching call. Customise with the config's `matrix`.",
    entries: [
      forms,
      entryOf(index, "defaultOutboundFaults"),
      entryOf(index, "DEFAULT_WEBHOOK_FAULTS"),
      ...entries,
    ],
  }
}

function entryOf(index: SourceIndex, name: string): SpecEntry {
  const declared = index.describe(SOURCES.runner, name)

  return {
    name,
    kind: declared.kind,
    signature: declared.signature,
    doc: declared.doc,
    members: [],
  }
}

/** Every error code with its class, the exit code it gives and what it means. */
export function errorSection(): SpecSection {
  return {
    topic: "errors",
    title: "Error codes",
    about:
      "Every failure carries one code. Its class decides the exit code: test, blocked and inconclusive exit 1, config 2, infra 3, interrupted 130. `danwo matrix` reports blocked, inconclusive and infra trials as not judged.",
    entries: errorCodeTable().map((row) => ({
      name: row.code,
      kind: row.class,
      signature: `exit ${row.exit}`,
      doc: row.meaning,
      members: [],
    })),
  }
}

/** Every cache outcome a step can report, with what its doc comment says it means. */
export function cacheSection(index: SourceIndex): SpecSection {
  const doc = index.describe(SOURCES.runner, "CacheOutcome").doc
  const meaning = (outcome: string) =>
    new RegExp(`\`${outcome}\`: ([^;]+?)(?:;|\\.\\s|\\.?$)`).exec(doc)?.[1]?.trim() ?? ""

  return {
    topic: "cache",
    title: "Cache outcomes",
    about:
      "What each agent step's replay came to; runs print a `cache:` summary line, and `danwo cache ls|stats|clear` manages recordings.",
    entries: CACHE_OUTCOMES.map((outcome) => ({
      name: outcome,
      kind: "outcome",
      signature: "",
      doc: meaning(outcome),
      members: [],
    })),
  }
}

/** The CLI's commands with their arguments and options, as the CLI defines them. */
export function cliSection(commands: readonly CliCommand[]): SpecSection {
  return {
    topic: "cli",
    title: "Commands",
    about: "`danwo <command>`; every command takes `--help`.",
    entries: commands.map((command) => ({
      name: command.name,
      kind: "command",
      signature: [
        `danwo ${command.name}`,
        ...command.arguments.map((arg) => {
          const name = `${arg.name}${arg.variadic ? "..." : ""}`

          return arg.required ? `<${name}>` : `[${name}]`
        }),
      ].join(" "),
      doc: command.description,
      members: [
        ...command.arguments.map((arg) => ({
          name: arg.name,
          signature: arg.choices.length > 0 ? arg.choices.join(" | ") : "",
          doc: arg.description,
        })),
        ...command.options.map((option) => ({
          name: option.flags,
          signature: [
            option.choices.length > 0 ? option.choices.join(" | ") : "",
            option.default === undefined ? "" : `default ${option.default}`,
          ]
            .filter((part) => part !== "")
            .join(", "),
          doc: option.description,
        })),
      ],
    })),
  }
}
