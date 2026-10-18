/** OAuth rules: sign-in requests that leave the flow open to forgery or code theft. */
import type { RecordedExchange } from "../../runner/record.ts"
import { exchangeEvidence, pathOf, providerOfHost, queryOf } from "../subject.ts"
import type { LintRule, LintSubject, RuleFinding } from "../types.ts"

/** Authorization endpoints by host: where a browser starts a sign-in. */
const AUTHORIZE: readonly (readonly [string, RegExp])[] = [
  ["accounts.google.com", /^\/o\/oauth2(\/v2)?\/auth$/],
  ["login.microsoftonline.com", /^\/[^/]+\/oauth2\/v2\.0\/authorize$/],
  ["github.com", /^\/login\/oauth\/authorize$/],
  ["slack.com", /^\/oauth\/v2\/authorize$/],
]

/** Providers whose sign-in supports PKCE for web apps. */
const PKCE = new Set(["google", "microsoft", "github"])

function isAuthorization(call: RecordedExchange): boolean {
  return (
    call.method === "GET" &&
    AUTHORIZE.some(([host, path]) => call.host === host && path.test(pathOf(call)))
  )
}

/** The first authorization request per provider that is missing `parameter`. */
function missing(
  subject: LintSubject,
  parameter: string,
  applies: (provider: string) => boolean,
  message: (provider: string) => string,
): RuleFinding[] {
  const reported = new Set<string>()

  return subject.exchanges.flatMap((call) => {
    const provider = providerOfHost(call.host) ?? "any"

    if (!isAuthorization(call) || !applies(provider) || reported.has(provider)) return []
    if (queryOf(call).has(parameter)) return []
    reported.add(provider)

    return [{ provider, message: message(provider), evidence: exchangeEvidence(subject, call) }]
  })
}

export const oauthState: LintRule = {
  id: "oauth/missing-state",
  severity: "warning",
  providers: ["google", "microsoft", "github", "slack"],
  summary:
    "A sign-in started without a state parameter, so a forged callback cannot be told apart.",
  hint: "Send a random state with every authorization request and check it on the callback before exchanging the code.",
  check: (subject) =>
    missing(
      subject,
      "state",
      () => true,
      (provider) => `a ${provider} sign-in started without a state parameter`,
    ),
}

export const oauthPkce: LintRule = {
  id: "oauth/missing-pkce",
  severity: "info",
  providers: ["google", "microsoft", "github"],
  summary: "A sign-in started without PKCE (no code_challenge).",
  hint: "Send a code_challenge (S256) and its verifier when exchanging the code, so a stolen code is useless on its own.",
  check: (subject) =>
    missing(
      subject,
      "code_challenge",
      (provider) => PKCE.has(provider),
      (provider) => `a ${provider} sign-in started without PKCE (no code_challenge)`,
    ),
}
