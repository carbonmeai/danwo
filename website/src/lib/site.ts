/**
 * The website's facts that change with decisions rather than code: where it is hosted, the
 * repository, the licence wording and the links that are not live yet. Everything that reads
 * them takes them from here.
 */

export const SITE = {
  name: "danwo",
  /** The address the site is served from; canonical links and the sitemap use it. */
  url: "https://danwo.dev",
  tagline: "Drive the UI. Judge everything behind it.",
  description:
    "The complete e2e testing framework for web and mobile apps, with service emulators, a fault matrix and checks on every side effect.",
  /**
   * The public repository, as `owner/name`. While it is unset, links to it point at the docs
   * and the star count is hidden.
   */
  repo: "carbonmeai/danwo" as string | undefined,
  branch: "main",
  /** How the site describes the licence: danwo is open source under Apache-2.0. */
  licence: {
    openSource: true,
    /** The licence's SPDX identifier, shown where the site names it. */
    name: "Apache-2.0",
    /** The words used where the site would otherwise say "open source". */
    wording: "Self-hosted",
  },
  /** Where "Join the waitlist" goes for the cloud version; unset hides the button. */
  waitlistUrl: undefined as string | undefined,
  /** Where "Talk to us" goes. */
  contactUrl: undefined as string | undefined,
} as const

/** The repository's web address, when it is public. */
export function repoUrl(): string | undefined {
  return SITE.repo === undefined ? undefined : `https://github.com/${SITE.repo}`
}

/** "Open source" when the licence makes danwo open source, else the agreed wording. */
export function licenceWords(): string {
  return SITE.licence.openSource ? "Open source" : SITE.licence.wording
}
