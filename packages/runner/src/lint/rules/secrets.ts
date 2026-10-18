/** Secret hygiene rules: server-only keys where anyone can read them. */
import { exchangeEvidence, providerOfHost, queryOf, routeOfExchange } from "../subject.ts"
import type { LintRule, LintSubject, RuleFinding } from "../types.ts"

/**
 * Server-only key shapes as they read after redaction: the prefix stays, the rest is
 * `[redacted]`, so a recorded URL still shows that a key was in it.
 */
const SECRET_IN_TEXT =
  /(sk_(?:test|live)_|sk_sandbox_|rk_(?:test|live)_|FLWSECK(?:_TEST)?-?|xox[bp]-|gh[opsu]_|github_pat_)/

/** A server-only key the browser sent: anyone who opens the page can copy it. */
function keysInBrowser(subject: LintSubject): RuleFinding[] {
  const reported = new Set<string>()

  return subject.exchanges.flatMap((call) => {
    if (call.origin !== "page" || call.credential?.kind !== "secret") return []

    const route = routeOfExchange(call)

    if (reported.has(route)) return []
    reported.add(route)

    return [
      {
        provider: providerOfHost(call.host) ?? "any",
        message: `the browser sent a server-only key (${call.credential.shape}…) to ${route}`,
        evidence: exchangeEvidence(subject, call),
      },
    ]
  })
}

/** A server-only key in a URL's query, where logs, proxies and history keep it. */
function keysInUrls(subject: LintSubject): RuleFinding[] {
  return subject.exchanges.flatMap((call) => {
    const parameter = [...queryOf(call)].find(([, value]) => SECRET_IN_TEXT.test(value))

    if (parameter === undefined) return []

    return [
      {
        provider: providerOfHost(call.host) ?? "any",
        message: `a server-only key was sent in the query parameter "${parameter[0]}" of ${routeOfExchange(call)}`,
        evidence: exchangeEvidence(subject, call),
      },
    ]
  })
}

/** A publishable key sent from the server, where a secret key belongs. */
function publishableOnServer(subject: LintSubject): RuleFinding[] {
  return subject.exchanges.flatMap((call) =>
    call.origin === "server" && call.credential?.kind === "publishable"
      ? [
          {
            provider: providerOfHost(call.host) ?? "any",
            message: `the app called ${routeOfExchange(call)} with a publishable key (${call.credential.shape}…)`,
            evidence: exchangeEvidence(subject, call),
          },
        ]
      : [],
  )
}

export const secretKeyInBrowser: LintRule = {
  id: "secrets/key-in-browser",
  severity: "error",
  providers: ["any"],
  summary:
    "The browser sent a server-only key (a Stripe or Paystack secret key, Flutterwave secret, Slack or GitHub token, Twilio credentials).",
  hint: "Call the provider from your server with the secret key; give the browser only a publishable key, or a short-lived token your server mints.",
  check: keysInBrowser,
}

export const secretKeyInUrl: LintRule = {
  id: "secrets/key-in-url",
  severity: "error",
  providers: ["any"],
  summary: "A server-only key was sent in a URL query string.",
  hint: "Send keys in the Authorization header; URLs end up in logs, proxies and browser history.",
  check: keysInUrls,
}

export const publishableKeyOnServer: LintRule = {
  id: "secrets/publishable-on-server",
  severity: "info",
  providers: ["stripe", "paystack", "flutterwave"],
  summary: "The app's server called a provider with a publishable key instead of its secret key.",
  hint: "Publishable keys are for the browser; server calls should use the secret key from your server's environment.",
  check: publishableOnServer,
}
