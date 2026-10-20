import type { FailureVerdict } from "@danwo/runner/runner"
import { VERDICT_LABELS } from "@danwo/runner/verdict"
import { Tooltip, TooltipContent, TooltipTrigger } from "@danwo/ui/primitives/tooltip"

import { WHOSE_TONE } from "../lib/whose.ts"
import { VerdictBadge } from "./status-badge.tsx"

/**
 * Whose failure it was, as a badge: app bug, test issue, environment, danwo bug or undecided, with
 * why in its tooltip. It sits above a row's whole-row link so the tooltip can be reached.
 */
export function WhoseBadge({
  verdict,
  detail,
}: {
  readonly verdict: Pick<FailureVerdict, "verdict"> & Partial<FailureVerdict>
  /** What the tooltip says instead of the verdict's own reason, such as a run's split. */
  readonly detail?: string
}) {
  const label = VERDICT_LABELS[verdict.verdict]
  const why = detail ?? verdict.reason ?? label
  const said = verdict.confidence === "likely" ? `Likely: ${why}` : why

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <VerdictBadge
          tone={WHOSE_TONE[verdict.verdict]}
          tabIndex={0}
          position="relative"
          zIndex="1"
          data-verdict={verdict.verdict}
          aria-label={`${label}. ${said}`}
        >
          {label}
          {verdict.confidence === "likely" ? "?" : null}
        </VerdictBadge>
      </TooltipTrigger>
      <TooltipContent maxW="28rem" overflowWrap="anywhere">
        {said}
      </TooltipContent>
    </Tooltip>
  )
}
