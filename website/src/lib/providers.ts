/**
 * The providers danwo emulates, as the website shows them: the landing page's logos and the
 * docs' provider pages both read this list.
 */

/** One emulated provider. */
export interface Provider {
  /** The docs page's slug, under `/docs/providers/`. */
  readonly slug: string
  readonly name: string
  /** A square mark under `/icons/`, for light surfaces. */
  readonly icon: string
  /** The mark for dark surfaces, when the light one would disappear on them. */
  readonly iconDark?: string
  /** One sentence on what the emulator covers. */
  readonly summary: string
  /** Lower-case prefixes of the spec's environment and helper names that belong to it. */
  readonly prefixes: readonly string[]
  /** A `##` section of the providers guide written about this provider. */
  readonly guideSection?: string
  /** A whole guide written about this provider. */
  readonly guide?: string
  /** The `danwo fidelity` suite that checks this emulator against the real API. */
  readonly fidelity?: string
}

export const PROVIDERS: readonly Provider[] = [
  {
    slug: "stripe",
    name: "Stripe",
    icon: "stripe.svg",
    summary:
      "Payments, Checkout, customers, subscriptions and signed webhooks, answered on api.stripe.com and checkout.stripe.com.",
    prefixes: ["stripe"],
    fidelity: "stripe",
  },
  {
    slug: "resend",
    name: "Resend",
    icon: "resend.svg",
    iconDark: "resend-on-dark.svg",
    summary:
      "Sending, batches, domains, API keys and delivery webhooks, with every accepted email readable from the test.",
    prefixes: ["resend"],
    fidelity: "resend",
  },
  {
    slug: "s3",
    name: "S3 and Tigris",
    icon: "s3.svg",
    summary:
      "Buckets and objects over the S3 API, for Amazon S3 and Tigris hostnames, with presigned URLs.",
    prefixes: ["s3"],
  },
  {
    slug: "aws",
    name: "AWS through MiniStack",
    icon: "s3.svg",
    summary:
      "Every other AWS service forwarded to a MiniStack you run or danwo starts, with the original hostnames kept.",
    prefixes: ["aws", "ministack"],
  },
  {
    slug: "google",
    name: "Google",
    icon: "google.svg",
    summary:
      "Google sign-in, Gmail, Calendar and Drive, with mailboxes and files a test can read and change.",
    prefixes: ["google", "gmail", "revokegoogle"],
    fidelity: "google",
  },
  {
    slug: "microsoft",
    name: "Microsoft",
    icon: "microsoft.svg",
    summary:
      "Microsoft sign-in and Graph: Outlook mail and calendar, OneDrive and change subscriptions.",
    prefixes: ["microsoft", "outlook", "onedrive", "graph", "revokemicrosoft"],
    fidelity: "microsoft",
  },
  {
    slug: "slack",
    name: "Slack",
    icon: "slack.svg",
    summary: "The Web API, OAuth installs and signed Events API deliveries for a seeded workspace.",
    prefixes: ["slack"],
    fidelity: "slack",
  },
  {
    slug: "github",
    name: "GitHub",
    icon: "github.svg",
    iconDark: "github-on-dark.svg",
    summary:
      "The REST API, OAuth Apps and GitHub Apps with installations, check runs and signed webhooks.",
    prefixes: ["github", "installgithub", "uninstallgithub"],
    fidelity: "github",
  },
  {
    slug: "twilio",
    name: "Twilio",
    icon: "twilio.svg",
    summary: "Messages and Verify, with every text readable like mail, so SMS codes replay too.",
    prefixes: ["twilio"],
    fidelity: "twilio",
  },
  {
    slug: "paystack",
    name: "Paystack",
    icon: "paystack.svg",
    summary:
      "Transactions paid on the hosted page, plans and subscriptions, transfers, refunds and banks, with signed webhooks.",
    prefixes: ["paystack"],
    fidelity: "paystack",
  },
  {
    slug: "flutterwave",
    name: "Flutterwave",
    icon: "flutterwave.svg",
    summary:
      "Payment links paid on the hosted checkout, verification, plans, transfers and virtual accounts, with signed webhooks.",
    prefixes: ["flutterwave"],
    fidelity: "flutterwave",
  },
  {
    slug: "bachs",
    name: "Bachs",
    icon: "bachs.png",
    summary:
      "Checkout, payments, subscriptions with recovery, payouts and the customer portal, settling on the emulator's clock.",
    prefixes: ["bachs"],
    fidelity: "bachs",
  },
  {
    slug: "auth0",
    name: "Auth0",
    icon: "auth0.svg",
    summary:
      "Universal Login, MFA, the authentication API, OIDC discovery and the Management API, on the tenant's own domain.",
    prefixes: ["auth0"],
    guideSection: "Auth0",
  },
  {
    slug: "clerk",
    name: "Clerk",
    icon: "clerk.svg",
    iconDark: "clerk-on-dark.svg",
    summary:
      "The Backend and Frontend APIs and the Account Portal: sign-in, sign-up, sessions, organizations and emailed codes.",
    prefixes: ["clerk"],
    guideSection: "Clerk",
  },
  {
    slug: "composio",
    name: "Composio",
    icon: "composio.svg",
    iconDark: "composio-on-dark.svg",
    summary:
      "Toolkits, tools, connected accounts and triggers, with tool runs that can act on the other emulators.",
    prefixes: ["composio"],
    guideSection: "Composio",
    fidelity: "composio",
  },
  {
    slug: "model-apis",
    name: "Model APIs",
    icon: "openai.svg",
    iconDark: "openai-on-dark.svg",
    summary:
      "OpenAI, Anthropic and the Vercel AI Gateway answered from scripts: the same answers every run, at no cost.",
    prefixes: ["llm"],
    guide: "llm",
    fidelity: "gateway",
  },
]
