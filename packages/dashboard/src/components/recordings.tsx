import { Icons } from "@danwo/ui/icons/base"
import { HStack } from "@danwo/ui/jsx"
import { Button } from "@danwo/ui/primitives/button"
import { Span } from "@danwo/ui/primitives/typography"
import { createContext, useContext } from "react"

/** Whether a run's recordings are still on disk, and how many runs keep theirs. */
export interface Recordings {
  readonly pruned: boolean
  readonly keepRuns: number
}

const RecordingsContext = createContext<Recordings | undefined>(undefined)

/** Tells the rows of a run's page whether its recordings were deleted. */
export const RecordingsProvider = RecordingsContext.Provider

/** The run's recordings as its page was told; undefined outside a run's page. */
export function useRecordings(): Recordings | undefined {
  return useContext(RecordingsContext)
}

/** Why a recording is gone, as its tooltip and empty state say it. */
export function prunedWords(keepRuns: number): string {
  return `Only the latest ${keepRuns} runs keep recordings; change record.keepRuns to keep more.`
}

/**
 * In place of a Watch button, for a recording deleted with its run: a muted label and the play
 * button disabled, its tooltip saying why. The button stays focusable so the tooltip can be read.
 */
export function DeletedRecording({ keepRuns }: { readonly keepRuns: number }) {
  return (
    <HStack gap="1" data-pruned>
      <Span color="ink.faint" fontSize="1" whiteSpace="nowrap">
        recording deleted
      </Span>
      <Button
        variant="ghost"
        size="icon"
        aria-disabled="true"
        aria-label="Watch (recording deleted)"
        opacity="0.45"
        cursor="not-allowed"
        onClick={(event) => event.preventDefault()}
        tooltipChildren={prunedWords(keepRuns)}
      >
        <Icons.play size={14} />
      </Button>
    </HStack>
  )
}
