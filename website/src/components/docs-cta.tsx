/**
 * The small card under a docs page's table of contents: the cloud waitlist once there is one,
 * otherwise a pointer to running danwo in CI. It never links anywhere that is not live.
 */
import { Link } from "@tanstack/react-router"

import type { Lang } from "../lib/i18n.ts"
import { SITE } from "../lib/site.ts"

/** The CI card's words in each language, and the CI page it links to. */
const CI = {
  en: {
    title: "Run it on every pull request",
    text: "A GitHub check and one comment per pull request, with the flight records attached.",
    button: "Set up CI",
    to: "/docs/$",
  },
  "zh-CN": {
    title: "在每个 Pull Request 上运行",
    text: "每个 Pull Request 一个 GitHub Check 和一条评论，并附上完整的运行记录。",
    button: "配置 CI",
    to: "/zh-CN/docs/$",
  },
} as const

export function DocsCta({ lang = "en" }: { readonly lang?: Lang }) {
  if (SITE.waitlistUrl !== undefined)
    return (
      <div className="danwo-cta">
        <p className="danwo-cta-title">danwo Cloud</p>
        <p>Runs, records and matrices for the whole team, without hosting them yourself.</p>
        <a className="danwo-cta-button" href={SITE.waitlistUrl}>
          Join the waitlist
        </a>
      </div>
    )

  const ci = CI[lang]

  return (
    <div className="danwo-cta">
      <p className="danwo-cta-title">{ci.title}</p>
      <p>{ci.text}</p>
      <Link className="danwo-cta-button" to={ci.to} params={{ _splat: "ci" }}>
        {ci.button}
      </Link>
    </div>
  )
}
