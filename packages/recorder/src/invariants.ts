/**
 * Drafting a test's invariant from what a recording saw behind the app. For shapes danwo knows it
 * writes a concrete rule a person can check and keep: a number the app showed after a Stripe
 * checkout stays in step with the checkouts Stripe was paid for; a message or comment the app
 * posted in answer to a webhook is posted at most as often as it was recorded. Otherwise it lists
 * what the recording saw, so the person can write the rule.
 */
import { locatorCode } from "./locators.ts"
import type { Observation, ResolvedStep } from "./steps.ts"
import type { ImportLine, InvariantDraft } from "./writer.ts"

/** What a test file needs for its invariant: the invariant, and the imports and lines it uses. */
export interface InvariantPlan {
  readonly invariant: InvariantDraft | undefined
  readonly imports: readonly ImportLine[]
  readonly preamble: readonly string[]
  /** Lines for the file's top comment, e.g. why no invariant was drafted. */
  readonly header: readonly string[]
}

/** What the recorder knows about the environment when it drafts. */
export interface DraftFacts {
  readonly steps: readonly ResolvedStep[]
  /** The environment's fixture names: `stripe`, `slack`, `github`, `proxy`… */
  readonly fixtures: readonly string[]
  /** Checkout sessions Stripe had been paid for when the recording stopped, if it was read. */
  readonly paidCheckouts: number | undefined
  /** Every provider call and delivery of the recording, repeats included. */
  readonly calls: readonly string[]
}

const STRIPE_CHECKOUT =
  /api\.stripe\.com\/v1\/checkout\/sessions|^webhook checkout\.session\.completed$/

/** Writes a webhook's answer counts as: the provider, the call and its fixture type. */
const ANSWERS = [
  {
    fixture: "slack",
    type: "SlackFixtures",
    host: "slack.com",
    path: "/api/chat.postMessage",
    what: "Slack message",
  },
  {
    fixture: "github",
    type: "GithubFixtures",
    host: "api.github.com",
    path: "/comments",
    what: "GitHub comment",
  },
] as const

function extendWith(
  type: string,
  names: readonly string[],
): Pick<InvariantPlan, "imports" | "preamble"> {
  return {
    imports: [{ from: "@danwo/sdk", names: [`type ${type}`, "test as base", ...names] }],
    preamble: [`const test = base.extend<${type}>()`],
  }
}

/** The number an observation shows, and the page and locator to read it again with. */
function shownNumber(observed: Observation): number | undefined {
  if (observed.path === undefined || observed.query === undefined) return undefined

  const found = /\d+/.exec(observed.text)?.[0]

  return found === undefined ? undefined : Number(found)
}

/** How many checkouts Stripe was paid for, when the recording went through Stripe Checkout. */
function paidThroughCheckout(facts: DraftFacts): number | undefined {
  const paid = facts.paidCheckouts

  if (!facts.fixtures.includes("stripe") || paid === undefined || paid < 1) return undefined

  const checkedOut = facts.steps.some(({ effects }) => effects.some((e) => STRIPE_CHECKOUT.test(e)))

  return checkedOut ? paid : undefined
}

/** The last assertion that saw a number on one of the app's pages. */
function numberShown(facts: DraftFacts) {
  const step = facts.steps.findLast(
    ({ step: found }) => found.kind === "assert" && shownNumber(found.observed) !== undefined,
  )?.step

  return step?.kind === "assert" && step.observed.query !== undefined ? step : undefined
}

function stripeRule(facts: DraftFacts): InvariantPlan | undefined {
  const paid = paidThroughCheckout(facts)
  const asserted = numberShown(facts)

  if (paid === undefined || asserted?.observed.query === undefined) return undefined

  const number = shownNumber(asserted.observed) ?? 0
  const per = Number.isInteger(number / paid) ? String(number / paid) : `${number} / ${paid}`

  return {
    ...extendWith("StripeFixtures", ["z"]),
    header: [],
    invariant: {
      fixtures: ["app", "screen", "stripe", "expect"],
      body: [
        "/*",
        ` * Drafted from the recording: the page showed ${JSON.stringify(asserted.observed.text)} when Stripe had been`,
        ` * paid for ${String(paid)} checkout(s). However a run went, that number should stay in step with the`,
        " * checkouts Stripe was paid for. Check this is the rule your app means before relying on it.",
        " */",
        "const paid = await stripe.fetch(",
        '  new Request("https://api.stripe.com/v1/checkout/sessions?payment_status=paid&limit=100", {',
        '    headers: { authorization: "Bearer sk_test_danwo_recorder" },',
        "  }),",
        ")",
        "const { data } = z.object({ data: z.array(z.unknown()) }).parse(await paid.json())",
        "",
        `await app.open(${JSON.stringify(asserted.observed.path)})`,
        `const shown = Number(/\\d+/.exec(await ${locatorCode(asserted.observed.query)}.innerText())?.[0] ?? 0)`,
        "",
        `expect(shown).toBe(${per} * data.length)`,
      ],
    },
  }
}

function answerRule(facts: DraftFacts): InvariantPlan | undefined {
  if (!facts.calls.some((call) => call.startsWith("webhook "))) return undefined

  for (const answer of ANSWERS) {
    const posted = facts.calls.filter(
      (call) => call.startsWith(`POST ${answer.host}/`) && call.endsWith(answer.path),
    ).length

    if (posted === 0 || !facts.fixtures.includes(answer.fixture)) continue

    return {
      ...extendWith(answer.type, []),
      header: [],
      invariant: {
        fixtures: ["proxy", "expect"],
        body: [
          `/* Drafted from the recording: the app answered a webhook with ${String(posted)} ${answer.what}(s). A redelivered webhook must not make it answer again. */`,
          "const posted = proxy",
          "  .exchanges()",
          `  .filter((call) => call.method === "POST" && call.host === ${JSON.stringify(answer.host)} && call.path.split("?")[0]?.endsWith(${JSON.stringify(answer.path)}) && call.status === 200)`,
          "",
          `expect(posted.length).toBeLessThanOrEqual(${String(posted)})`,
        ],
      },
    }
  }

  return undefined
}

/** No rule danwo knows: the file says what the recording saw, and how to add one. */
function listOnly(facts: DraftFacts): InvariantPlan {
  const seen = [...new Set(facts.calls)]

  return {
    invariant: undefined,
    imports: [{ from: "@danwo/sdk", names: ["test"] }],
    preamble: [],
    header: [
      "No invariant was drafted. Add `.invariant(async (fixtures) => { … })` saying what must hold",
      "however a run went, then run `danwo matrix` on this file.",
      ...(seen.length === 0
        ? ["The recording saw no provider calls or webhooks behind the app."]
        : ["What the recording saw behind the app:", ...seen.map((call) => `  ${call}`)]),
    ],
  }
}

/** The invariant to draft for a recording, with what its file needs. */
export function draftInvariant(facts: DraftFacts): InvariantPlan {
  return stripeRule(facts) ?? answerRule(facts) ?? listOnly(facts)
}
