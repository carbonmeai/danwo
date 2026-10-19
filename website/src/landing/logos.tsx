/** The logo wall: every emulated provider, in grey until hovered, scrolling slowly. */

import { Logo, type LogoFiles } from "./logo.tsx"

/** A wordmark, or a square mark with the name beside it; `height` is the image's in pixels. */
interface WallLogo extends LogoFiles {
  readonly name: string
  readonly height: number
  readonly label?: boolean
}

const W = "wordmarks/"

const WALL: readonly WallLogo[] = [
  { name: "Stripe", src: `${W}stripe.svg`, height: 26 },
  { name: "Resend", src: `${W}resend.svg`, dark: `${W}resend-on-dark.svg`, height: 20 },
  { name: "Amazon S3", src: "s3.svg", height: 24, label: true },
  { name: "Tigris", src: `${W}tigris.svg`, dark: `${W}tigris-on-dark.svg`, height: 22 },
  { name: "Google", src: `${W}google.svg`, height: 24 },
  { name: "Microsoft", src: `${W}microsoft.svg`, height: 22 },
  { name: "Slack", src: `${W}slack.svg`, height: 24 },
  { name: "GitHub", src: `${W}github.svg`, dark: `${W}github-on-dark.svg`, height: 21 },
  { name: "Twilio", src: `${W}twilio.svg`, height: 22 },
  { name: "Paystack", src: `${W}paystack.svg`, height: 20 },
  { name: "Flutterwave", src: `${W}flutterwave.svg`, height: 30 },
  { name: "Bachs", src: `${W}bachs.png`, dark: `${W}bachs-on-dark.png`, height: 15 },
  { name: "Auth0", src: "auth0.svg", height: 22, label: true },
  { name: "Clerk", src: `${W}clerk.svg`, dark: `${W}clerk-on-dark.svg`, height: 22 },
  { name: "Composio", src: "composio.svg", dark: "composio-on-dark.svg", height: 22, label: true },
  { name: "OpenAI", src: `${W}openai.svg`, dark: `${W}openai-on-dark.svg`, height: 24 },
  { name: "Anthropic", src: `${W}anthropic.svg`, dark: `${W}anthropic-on-dark.svg`, height: 13 },
  { name: "AI Gateway", src: "vercel.svg", dark: "vercel-on-dark.svg", height: 16, label: true },
]

export function Logos() {
  return (
    <section className="logos">
      <div className="wrap">
        <p>Emulated behind an egress proxy. Your app keeps calling the real hostnames.</p>
        <div className="marquee">
          <div className="track">
            {[false, true].map((copy) =>
              WALL.map((logo) => (
                <span
                  key={`${logo.name}${copy ? "-copy" : ""}`}
                  className={copy ? "lg dupe" : "lg"}
                  style={{ "--h": `${logo.height}px` }}
                  title={logo.name}
                  aria-hidden={copy || undefined}
                >
                  <Logo files={logo} alt={logo.label || copy ? "" : logo.name} />
                  {logo.label && logo.name}
                </span>
              )),
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
