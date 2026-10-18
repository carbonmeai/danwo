/** Messaging rules: the same email, text or chat message sent twice for one trigger. */
import type { RecordedExchange } from "../../runner/record.ts"
import { exchangeEvidence, pathOf, providerOfHost, stepAt } from "../subject.ts"
import type { LintRule, LintSubject, RuleFinding } from "../types.ts"

/** Calls that send one message, by host and path. */
const SENDS: readonly (readonly [string, RegExp])[] = [
  ["api.resend.com", /^\/emails$/],
  ["api.twilio.com", /^\/2010-04-01\/Accounts\/[^/]+\/Messages\.json$/],
  ["gmail.googleapis.com", /^\/gmail\/v1\/users\/[^/]+\/messages\/send$/],
  ["graph.microsoft.com", /^\/v1\.0\/(me|users\/[^/]+)\/sendMail$/],
  ["slack.com", /^\/api\/chat\.postMessage$/],
]

function isSend(call: RecordedExchange): boolean {
  return (
    call.method === "POST" &&
    call.status !== null &&
    call.status < 400 &&
    SENDS.some(([host, path]) => call.host === host && path.test(pathOf(call)))
  )
}

/** What makes two sends the same message: the step, the endpoint and the body. */
function sameness(subject: LintSubject, call: RecordedExchange): string | undefined {
  const body = call.request?.body

  if (body === null || body === undefined || body === "") return undefined

  return `${stepAt(subject.steps, call.startedAt)?.index ?? -1} ${call.host}${pathOf(call)} ${body}`
}

/**
 * Two sends with the same body in the same step: one action sent one message twice. Messages in
 * different steps may be legitimately alike (two sign-ins, two codes), so only one step counts.
 */
function duplicateSends(subject: LintSubject): RuleFinding[] {
  const seen = new Set<string>()

  return subject.exchanges.filter(isSend).flatMap((call) => {
    const key = sameness(subject, call)

    if (key === undefined) return []

    if (!seen.has(key)) {
      seen.add(key)

      return []
    }

    return [
      {
        provider: providerOfHost(call.host) ?? "any",
        message: `the same message was sent twice to ${call.host}${pathOf(call)} in one step`,
        evidence: exchangeEvidence(subject, call),
      },
    ]
  })
}

export const duplicateMessage: LintRule = {
  id: "messages/duplicate-send",
  severity: "warning",
  providers: ["resend", "twilio", "google", "microsoft", "slack"],
  summary: "The same email, text or chat message was sent twice for one action.",
  hint: "Send once per trigger: dedupe on the event or job id that caused the message, and make retries reuse the first send's id.",
  check: duplicateSends,
}
