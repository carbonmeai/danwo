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
  /** The folders of `packages/emulators/src` this page covers. */
  readonly emulators: readonly string[]
  /** A `##` section of the providers guide written about this provider. */
  readonly guideSection?: string
  /** A whole guide written about this provider. */
  readonly guide?: string
  /** The `danwo fidelity` suites that check this emulator against the real API. */
  readonly fidelity?: readonly string[]
  /** How far those suites reach: what runs against the real API and what only offline. */
  readonly fidelityNote?: string
}

export const PROVIDERS: readonly Provider[] = [
  {
    slug: "stripe",
    name: "Stripe",
    icon: "stripe.svg",
    summary:
      "Payments, Checkout, subscriptions, invoices, the billing portal, a Stripe.js stand-in and signed webhooks, on api.stripe.com and checkout.stripe.com.",
    prefixes: ["stripe"],
    emulators: ["stripe"],
    guideSection: "Stripe",
    fidelity: ["stripe"],
    fidelityNote: "Checked live against a test-mode account, subscriptions and invoices included.",
  },
  {
    slug: "resend",
    name: "Resend",
    icon: "resend.svg",
    iconDark: "resend-on-dark.svg",
    summary:
      "Sending, batches, domains, API keys and delivery webhooks, with every accepted email readable from the test.",
    prefixes: ["resend"],
    emulators: ["resend"],
    fidelity: ["resend"],
    fidelityNote: "Checked live, sending only to Resend's test addresses.",
  },
  {
    slug: "s3",
    name: "S3 and Tigris",
    icon: "s3.svg",
    summary:
      "Objects, listings, multipart uploads, presigned URLs and conditional requests over the S3 API, for Amazon S3 and Tigris hosts, the Tigris SDK included.",
    prefixes: ["s3"],
    emulators: ["s3"],
    guideSection: "S3 and Tigris",
    fidelity: ["s3"],
    fidelityNote:
      "Checked live against a Tigris bucket, writing only under its own prefix and deleting what it wrote.",
  },
  {
    slug: "aws",
    name: "AWS through MiniStack",
    icon: "s3.svg",
    summary:
      "Every other AWS service forwarded to a MiniStack you run or danwo starts, with the original hostnames kept.",
    prefixes: ["aws", "ministack"],
    emulators: [],
  },
  {
    slug: "google",
    name: "Google",
    icon: "google.svg",
    summary:
      "Google sign-in, Gmail, Calendar and Drive, with mailboxes and files a test can read and change.",
    prefixes: ["google", "gmail", "revokegoogle"],
    emulators: ["google"],
    fidelity: ["google"],
    fidelityNote: "Checked live on Google's public sign-in endpoints.",
  },
  {
    slug: "microsoft",
    name: "Microsoft",
    icon: "microsoft.svg",
    summary:
      "Microsoft sign-in and Graph: Outlook mail and calendar, OneDrive and change subscriptions.",
    prefixes: ["microsoft", "outlook", "onedrive", "graph", "revokemicrosoft"],
    emulators: ["microsoft"],
    fidelity: ["microsoft"],
    fidelityNote: "Checked live on Microsoft's public sign-in endpoints.",
  },
  {
    slug: "slack",
    name: "Slack",
    icon: "slack.svg",
    summary: "The Web API, OAuth installs and signed Events API deliveries for a seeded workspace.",
    prefixes: ["slack"],
    emulators: ["slack"],
    fidelity: ["slack"],
    fidelityNote: "Checked live on Slack's public calls.",
  },
  {
    slug: "github",
    name: "GitHub",
    icon: "github.svg",
    iconDark: "github-on-dark.svg",
    summary:
      "The REST API, OAuth Apps and GitHub Apps with installations, check runs and signed webhooks.",
    prefixes: ["github", "installgithub", "uninstallgithub"],
    emulators: ["github"],
    fidelity: ["github"],
    fidelityNote: "Checked live on GitHub's public calls.",
  },
  {
    slug: "twilio",
    name: "Twilio",
    icon: "twilio.svg",
    summary:
      "Messages and Verify, the account and its numbers, and trial accounts' refusals, with every text readable like mail.",
    prefixes: ["twilio"],
    emulators: ["twilio"],
    guideSection: "Twilio",
    fidelity: ["twilio"],
    fidelityNote:
      "Checked live without sending: account reads and the sends Twilio refuses before a message exists.",
  },
  {
    slug: "paystack",
    name: "Paystack",
    icon: "paystack.svg",
    summary:
      "Transactions paid on the hosted page, plans and subscriptions, transfers, refunds and banks, with signed webhooks.",
    prefixes: ["paystack"],
    emulators: ["paystack"],
    fidelity: ["paystack"],
    fidelityNote: "Checked live against a test key.",
  },
  {
    slug: "flutterwave",
    name: "Flutterwave",
    icon: "flutterwave.svg",
    summary:
      "Payment links paid on the hosted checkout, verification, plans, transfers and virtual accounts, with signed webhooks.",
    prefixes: ["flutterwave"],
    emulators: ["flutterwave"],
    fidelity: ["flutterwave"],
    fidelityNote: "Checked live against a test key.",
  },
  {
    slug: "bachs",
    name: "Bachs",
    icon: "bachs.png",
    summary:
      "Checkout, payments, subscriptions with recovery, payouts and the customer portal, settling on the emulator's clock.",
    prefixes: ["bachs"],
    emulators: ["bachs"],
    fidelity: ["bachs"],
    fidelityNote: "Checked live against a sandbox key.",
  },
  {
    slug: "auth0",
    name: "Auth0",
    icon: "auth0.svg",
    summary:
      "Universal Login, MFA, the authentication API, OIDC discovery and the Management API, on the tenant's own domain.",
    prefixes: ["auth0"],
    emulators: ["auth0"],
    guideSection: "Auth0",
  },
  {
    slug: "clerk",
    name: "Clerk",
    icon: "clerk.svg",
    iconDark: "clerk-on-dark.svg",
    summary:
      "The Backend and Frontend APIs and the Account Portal, with svix-signed webhooks, stable seeded ids and the signing key as a PEM.",
    prefixes: ["clerk"],
    emulators: ["clerk"],
    guideSection: "Clerk",
    fidelity: ["clerk"],
    fidelityNote:
      "Checked live against a development instance, sign-up and sign-in by Clerk's test addresses included.",
  },
  {
    slug: "nylas",
    name: "Nylas",
    icon: "nylas.png",
    summary:
      "Hosted auth and grants, mail, calendars, contacts and the scheduler of Nylas v3, with signed webhooks.",
    prefixes: ["nylas"],
    emulators: ["nylas"],
    guideSection: "Nylas",
    fidelity: ["nylas"],
    fidelityNote: "Checked live: key errors, and the application's grants (reads only).",
  },
  {
    slug: "nango",
    name: "Nango",
    icon: "nango.png",
    iconDark: "nango-on-dark.png",
    summary:
      "Connect sessions and the Connect UI, refreshing connections, the proxy to other emulators, actions and signed webhooks.",
    prefixes: ["nango"],
    emulators: ["nango"],
    guideSection: "Nango",
    fidelity: ["nango"],
    fidelityNote: "Checked live: key errors, and the project's integrations and connections.",
  },
  {
    slug: "unipile",
    name: "Unipile",
    icon: "unipile.png",
    summary:
      "Hosted auth links, LinkedIn, WhatsApp and mail accounts, chats, messages and mail, with webhooks.",
    prefixes: ["unipile"],
    emulators: ["unipile"],
    guideSection: "Unipile",
    fidelity: ["unipile"],
    fidelityNote: "Checked live: an unknown token, and the connected accounts.",
  },
  {
    slug: "pusher",
    name: "Pusher",
    icon: "pusher.svg",
    iconDark: "pusher-on-dark.svg",
    summary:
      "The Channels API and the pusher-js socket with private and presence channels, signed webhooks, and Beams.",
    prefixes: ["pusher"],
    emulators: ["pusher"],
    guideSection: "Pusher",
    fidelity: ["pusher"],
    fidelityNote:
      "Checked live against a test app; subscription counts follow the app's own setting.",
  },
  {
    slug: "novu",
    name: "Novu",
    icon: "novu.svg",
    iconDark: "novu-on-dark.svg",
    summary:
      "Triggers, subscribers and topics, code-first workflows through the app's bridge, and the Inbox with its realtime socket.",
    prefixes: ["novu"],
    emulators: ["novu"],
    guideSection: "Novu",
    fidelity: ["novu"],
    fidelityNote: "Checked live against a development environment, deleting what it creates.",
  },
  {
    slug: "tiptap",
    name: "Tiptap",
    icon: "tiptap.png",
    iconDark: "tiptap-on-dark.png",
    summary:
      "Tiptap Cloud collaboration: documents synced over the Hocuspocus protocol, token permissions and the documents REST API.",
    prefixes: ["tiptap"],
    emulators: ["tiptap"],
    guideSection: "Tiptap",
    fidelity: ["tiptap"],
    fidelityNote: "Checked live against a Tiptap Cloud app, deleting the documents it creates.",
  },
  {
    slug: "composio",
    name: "Composio",
    icon: "composio.svg",
    iconDark: "composio-on-dark.svg",
    summary:
      "Toolkits, tools, connected accounts and triggers, with tool runs that can act on the other emulators.",
    prefixes: ["composio"],
    emulators: ["composio"],
    guideSection: "Composio",
    fidelity: ["composio"],
    fidelityNote: "Checked live, reading the catalogue and the project only.",
  },
  {
    slug: "model-apis",
    name: "Model APIs",
    icon: "openai.svg",
    iconDark: "openai-on-dark.svg",
    summary:
      "OpenAI, Anthropic, Gemini, Perplexity, Bedrock and the Vercel AI Gateway answered from scripts: the same answers every run, at no cost.",
    prefixes: ["llm"],
    emulators: ["llm"],
    guide: "llm",
    fidelity: ["gateway", "gemini", "perplexity", "bedrock"],
    fidelityNote:
      "The AI Gateway is checked live; Gemini, Perplexity and Bedrock against their published API descriptions.",
  },
]

/** Folders of `packages/emulators/src` shared by several emulators rather than one provider. */
export const SHARED_EMULATOR_FOLDERS: readonly string[] = ["oauth"]
