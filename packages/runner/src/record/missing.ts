/**
 * Screenshots and videos a run meant to keep but did not, each with why: a record without its
 * evidence otherwise reads as if nothing was ever filmed.
 */

/**
 * Why it is missing: `failed`, the browser or the disk failed to save it; `secret`, a secret
 * showed on the page as text, which video cannot hide; `closed`, its tab had closed before it
 * could be taken; `setting`, the run's `video` setting left it out.
 */
export type MissingCause = "failed" | "secret" | "closed" | "setting"

/** A screenshot or video that is not in the record. */
export interface MissingArtifact {
  readonly kind: "screenshot" | "video"
  readonly cause: MissingCause
  /** Why, in words: `saving it failed: ENOSPC: no space left on device`. */
  readonly reason: string
  /** The step whose screenshot it is; absent for the screenshot at failure and for a video. */
  readonly step?: number
  /** For the screenshot taken when the attempt failed. */
  readonly atFailure?: true
  /** The tab a video would show, 1 for the first. */
  readonly tab?: number
  /** The person whose browser a video would show, when the test opened more than one. */
  readonly user?: string
}

/** The first line of what `error` says, at most 200 characters: a reason for a record. */
export function failureReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  return (text.split("\n")[0] ?? "").trim().slice(0, 200)
}

/**
 * Whether the run asked for this and lost it: a video or screenshot that failed to save, or a
 * video withheld because a secret showed. A video the `video` setting left out was not asked for.
 */
export function unexpectedlyMissing(missing: MissingArtifact): boolean {
  return missing.cause === "failed" || (missing.kind === "video" && missing.cause === "secret")
}

/** What a missing artifact is, for a line of text: `the video of tab 2`, `step 4's screenshot`. */
function missingLabel(missing: MissingArtifact): string {
  if (missing.kind === "video") {
    const tab = missing.tab === undefined ? "" : ` of tab ${missing.tab}`

    return `the video${tab}${missing.user === undefined ? "" : ` (${missing.user})`}`
  }

  if (missing.atFailure === true) return "the screenshot at failure"

  return missing.step === undefined ? "a screenshot" : `step ${missing.step}'s screenshot`
}

/** `1 video`, `2 screenshots`. */
function counted(count: number, kind: MissingArtifact["kind"]): string {
  return `${count} ${kind}${count === 1 ? "" : "s"}`
}

/** How many of the lost artifacts the run's warning names before it says how many more. */
const NAMED = 3

/**
 * The run's one warning about the screenshots and videos its tests asked for and lost, each
 * test's added up: `danwo: 1 video was not saved (the run's result stands): checkout, the video
 * of tab 1: saving it failed: ENOSPC …`. None when nothing was lost.
 */
export function missingLine(
  lost: readonly { readonly test: string; readonly missing: MissingArtifact }[],
): string | undefined {
  if (lost.length === 0) return undefined

  const videos = lost.filter((each) => each.missing.kind === "video").length
  const shots = lost.length - videos
  const counts = [
    ...(videos > 0 ? [counted(videos, "video")] : []),
    ...(shots > 0 ? [counted(shots, "screenshot")] : []),
  ].join(" and ")
  const named = lost
    .slice(0, NAMED)
    .map(
      ({ test, missing }) =>
        `${test}, ${missingLabel(missing)}: ${missing.reason.replace(/\.+$/, "")}`,
    )
  const more = lost.length > NAMED ? `; and ${lost.length - NAMED} more` : ""

  return `danwo: ${counts} ${lost.length === 1 ? "was" : "were"} not saved (the run's result stands): ${named.join("; ")}${more}. Each record's \`missing\` says why.`
}
