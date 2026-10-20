import type { FailureVerdict } from "@danwo/runner/runner"
import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack } from "@danwo/ui/jsx"
import { Badge } from "@danwo/ui/primitives/badge"
import { Button } from "@danwo/ui/primitives/button"
import { ButtonGroup } from "@danwo/ui/primitives/button-group"
import { DialogTitle } from "@danwo/ui/primitives/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@danwo/ui/primitives/dropdown-menu"
import { Span } from "@danwo/ui/primitives/typography"
import { useState } from "react"

import { useCopied } from "../../components/copy-link.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { WhoseBadge } from "../../components/whose-badge.tsx"
import { duration } from "../../lib/format.ts"
import { toneOf } from "../../lib/verdicts.ts"
import { RerunTest } from "../live/run-actions.tsx"
import type { RecordView } from "../record/record-data.ts"
import { clock, type ReplayTabMark, stepAt } from "../record/record-replay.ts"
import type { Playback } from "../record/use-playback.ts"
import { sendFeedback } from "./feedback-api.ts"
import {
  type TranscriptStep,
  type Warning,
  afterBody,
  checkWords,
  fixPrompt,
  tabMovesBefore,
  transcriptOf,
  warningsOf,
} from "./overlay-values.ts"

const WARNING_TONE: Readonly<Record<Warning["kind"], string>> = {
  error: "verdict.failed.fg",
  fault: "verdict.flaky.fg",
  lint: "verdict.flaky.fg",
  note: "ink.soft",
}

/**
 * Copies the failure as a prompt for a coding agent, with a menu beside it to copy the failure
 * page itself as Markdown: the library's button group and dropdown menu.
 */
function CopyFix({
  test,
  page,
  verdict,
}: {
  readonly test: string
  readonly page: string
  readonly verdict: FailureVerdict | undefined
}) {
  const [copied, copy] = useCopied("Prompt copied")
  const [, copyPage] = useCopied("Failure page copied")

  return (
    <ButtonGroup role="group" aria-label="Copy the failure">
      <Button variant="solid" size="sm" onClick={() => copy(fixPrompt(test, page, verdict))}>
        {copied ? <Icons.copyCheck size={14} /> : <Icons.aiStar size={14} />}
        <Span aria-live="polite">{copied ? "Copied" : "Copy prompt to fix"}</Span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="solid" size="sm" px="2" aria-label="More ways to copy">
            <Icons.caretDown size={12} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" minW="15rem">
          <DropdownMenuItem gap="2" onSelect={() => copy(fixPrompt(test, page, verdict))}>
            <Icons.aiStar size={14} />
            Copy prompt to fix
          </DropdownMenuItem>
          <DropdownMenuItem gap="2" onSelect={() => copyPage(page)}>
            <Icons.copy size={14} />
            Copy the failure page (Markdown)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}

/** Thumbs up or down on whether the recording helped, kept in the project's `.danwo` folder. */
function Feedback({ dir }: { readonly dir: string }) {
  const [vote, setVote] = useState<"up" | "down">()

  const send = (next: "up" | "down") => {
    setVote(next)
    void sendFeedback({ data: { record: dir, vote: next } })
  }

  return (
    <HStack gap="0.5" role="group" aria-label="Was this useful?">
      {(["up", "down"] as const).map((each) => (
        <Button
          key={each}
          variant={vote === each ? "soft" : "ghost"}
          size="icon"
          aria-pressed={vote === each}
          aria-label={each === "up" ? "Useful" : "Not useful"}
          tooltipChildren={each === "up" ? "This helped" : "This did not help"}
          onClick={() => send(each)}
        >
          <Box
            display="inline-flex"
            style={{
              transform: each === "down" ? "rotate(180deg)" : undefined,
            }}
          >
            <Icons.thumbsUp size={14} />
          </Box>
        </Button>
      ))}
    </HStack>
  )
}

/**
 * Whose browser the transcript moves to at step `at`, when the test opened more than one person's
 * and the step before ran in another's.
 */
function switchedTo(steps: readonly TranscriptStep[], at: number): string | undefined {
  const step = steps[at]

  if (step === undefined || !steps.some((each) => each.user !== undefined)) return undefined
  if (at > 0 && steps[at - 1]?.user === step.user) return undefined

  return step.user === undefined ? "Your browser" : `${step.user}'s browser`
}

/** The line above a step where the test moves to another person's browser. */
function UserSwitch({ who }: { readonly who: string }) {
  return (
    <HStack gap="2" px="2" pt="2" pb="1" color="ink.muted" fontSize="1" fontWeight="600">
      <Span>{who}</Span>
      <Box flex="1" h="1px" bg="hairline" />
    </HStack>
  )
}

/** The line above a step where a popup opened or the run came back from one; it jumps there. */
function TabMove({
  mark,
  playback,
}: {
  readonly mark: ReplayTabMark
  readonly playback: Playback | undefined
}) {
  const icon =
    mark.kind === "opened" ? <Icons.exportSquare size={12} /> : <Icons.cornerDownLeft size={12} />

  return (
    <HStack gap="2" px="2" pt="1.5" pb="0.5" color="ink.muted" fontSize="1">
      {playback ? (
        <Button
          variant="ghost"
          size="xs"
          h="5"
          px="1.5"
          aria-label={`${mark.label}, at ${clock(mark.atMs - playback.startMs)}`}
          onClick={() => playback.showAt(mark.video, mark.atMs)}
        >
          {icon}
          {mark.label}
        </Button>
      ) : (
        <HStack gap="1.5">
          {icon}
          <Span>{mark.label}</Span>
        </HStack>
      )}
      <Box flex="1" h="1px" bg="hairline" />
    </HStack>
  )
}

/** One step of the transcript: its number, what it did, and a jump to it in the replay. */
function StepLine({
  step,
  current,
  switched,
  moves = [],
  playback,
}: {
  readonly step: TranscriptStep
  readonly current: boolean
  readonly switched: string | undefined
  /** Popups that opened, or closed, just before this step. */
  readonly moves?: readonly ReplayTabMark[]
  readonly playback: Playback | undefined
}) {
  const failed = toneOf(step.status) === "failed"

  return (
    <Box role="listitem">
      {switched === undefined ? null : <UserSwitch who={switched} />}
      {moves.map((mark) => (
        <TabMove key={`${mark.kind}-${mark.video}`} mark={mark} playback={playback} />
      ))}
      <StepBody step={step} current={current} failed={failed} playback={playback} />
    </Box>
  )
}

/** How a jump to a step names it. */
function stepNoun(step: TranscriptStep): string {
  if (step.kind === "check") return "the check"
  if (step.kind === "settle") return "the wait for background work"

  return `step ${step.index + 1}`
}

/** A step's mark: its number, a ✓ or ✗ for a value check, a clock for the settle wait. */
function StepMarker({ step, failed }: { readonly step: TranscriptStep; readonly failed: boolean }) {
  const passedCheck = step.kind === "check" && !failed

  return (
    <Span
      display="grid"
      placeItems="center"
      h="6"
      w="6"
      rounded="full"
      fontSize="1"
      fontWeight="600"
      bg={failed ? "verdict.failed.bg" : passedCheck ? "verdict.passed.bg" : "surface.hover"}
      color={failed ? "verdict.failed.fg" : passedCheck ? "verdict.passed.fg" : "ink.soft"}
    >
      {step.kind === "check" ? (
        <Span role="img" aria-label={failed ? "Failed" : "Passed"} display="inline-flex">
          {failed ? <Icons.x size={12} /> : <Icons.check size={12} />}
        </Span>
      ) : step.kind === "settle" ? (
        <Icons.clock size={12} />
      ) : (
        step.index + 1
      )}
    </Span>
  )
}

/** What a check got and wanted, or what the settle wait waited for, one line each. */
function StepDetail({ step, failed }: { readonly step: TranscriptStep; readonly failed: boolean }) {
  const words = checkWords(step)

  if (words !== undefined)
    return (
      <Span
        color={failed ? "verdict.failed.fg" : "ink.muted"}
        fontSize="1"
        fontFamily="mono"
        overflowWrap="anywhere"
      >
        {words}
      </Span>
    )

  if (step.kind !== "settle") return null

  return (
    <Stack gap="0.5" color="ink.muted" fontSize="1" aria-label="Waited for">
      {(step.waitedOn ?? []).length === 0 ? (
        <Span>Nothing was running.</Span>
      ) : (
        step.waitedOn?.map((line) => (
          <Span key={line} overflowWrap="anywhere">
            {line}
          </Span>
        ))
      )}
    </Stack>
  )
}

/**
 * What ran after the body: the wait for background work, then the invariant's checks of what the
 * app did, each a ✓ or ✗ with its values.
 */
function ChecksSection({
  steps,
  playing,
  playback,
}: {
  readonly steps: readonly TranscriptStep[]
  readonly playing: number | undefined
  readonly playback: Playback | undefined
}) {
  return (
    <Stack gap="1" mt="3" aria-labelledby="transcript-checks">
      <HStack gap="2" px="2" color="ink.muted" fontSize="1" fontWeight="600">
        <Span id="transcript-checks">Checks</Span>
        <Box flex="1" h="1px" bg="hairline" />
      </HStack>
      <Box role="list" display="grid" gap="0.5" aria-label="Checks">
        {steps.map((step) => (
          <StepLine
            key={step.index}
            step={step}
            current={step.index === playing}
            switched={undefined}
            playback={playback}
          />
        ))}
      </Box>
    </Stack>
  )
}

/** A step's number, label, jump button, person, API, cache and time, and its error. */
function StepBody({
  step,
  current,
  failed,
  playback,
}: {
  readonly step: TranscriptStep
  readonly current: boolean
  readonly failed: boolean
  readonly playback: Playback | undefined
}) {
  return (
    <Box
      display="grid"
      gridTemplateColumns="1.75rem minmax(0, 1fr)"
      gap="2"
      px="2"
      py="2"
      rounded="lg"
      bg={current ? "surface.active" : undefined}
      aria-current={current ? "step" : undefined}
    >
      <StepMarker step={step} failed={failed} />
      <Stack gap="1" minW="0">
        <Span fontWeight="500" overflowWrap="anywhere">
          {step.kind === "settle" ? "Waiting for background work" : step.label}
        </Span>
        <StepDetail step={step} failed={failed} />
        <HStack gap="2" color="ink.muted" fontSize="1" flexWrap="wrap">
          {playback && step.atMs !== undefined ? (
            <Button
              variant="soft"
              size="xs"
              h="5"
              px="1.5"
              aria-label={`Go to ${stepNoun(step)}, at ${clock(step.atMs - playback.startMs)}`}
              onClick={() => playback.showAt(step.video ?? playback.tab, step.atMs ?? 0)}
            >
              <Icons.play size={10} />
              {clock(step.atMs - playback.startMs)}
            </Button>
          ) : null}
          {step.user === undefined ? null : <Span fontWeight="600">{step.user}</Span>}
          {step.popup ? (
            <Badge look="soft" size="sm" colorPalette="palette.blue">
              popup
            </Badge>
          ) : null}
          <Span>{step.api}</Span>
          {step.cache ? <Span>cache: {step.cache}</Span> : null}
          <Span>{duration(step.durationMs)}</Span>
        </HStack>
        {step.error ? (
          <Span color="verdict.failed.fg" fontSize="1" overflowWrap="anywhere">
            {step.error}
          </Span>
        ) : null}
      </Stack>
    </Box>
  )
}

/**
 * The overlay's left pane: the test and how it went, the steps as a numbered transcript that jumps
 * the replay, and pinned at the bottom the warnings, the copy-to-fix button and feedback.
 */
export function Transcript({
  view,
  playback,
}: {
  readonly view: RecordView
  readonly playback: Playback | undefined
}) {
  const { record } = view
  const steps = transcriptOf(view, view.replay)
  const body = steps.filter((step) => !afterBody(step))
  const checks = steps.filter(afterBody)
  const warnings = warningsOf(record)
  const playing = playback ? stepAt(playback.marks, playback.ms) : undefined

  return (
    <Stack gap="0" h="full" minH="0">
      <Stack
        gap="2"
        pl="5"
        pr={{ base: "12", md: "5" }}
        pt="5"
        pb="4"
        boxShadow="inset 0 -1px 0 {colors.hairline}"
      >
        <HStack justify="space-between" gap="3" alignItems="flex-start">
          <DialogTitle fontSize="2" fontWeight="600" overflowWrap="anywhere">
            {record.test}
          </DialogTitle>
          <HStack gap="1.5" flexShrink="0">
            {record.verdict ? <WhoseBadge verdict={record.verdict} /> : null}
            <StatusBadge status={record.status} />
          </HStack>
        </HStack>
        <HStack gap="3" color="ink.muted" fontSize="1" flexWrap="wrap">
          <Span>{new Date(record.startedAt).toLocaleString()}</Span>
          <Span>{duration(record.durationMs)}</Span>
          {record.run.kind === "matrix" ? (
            <Span>matrix: {record.run.fault?.label ?? "clean run"}</Span>
          ) : record.run.attempt > 1 ? (
            <Span>retry {record.run.attempt - 1}</Span>
          ) : null}
          <Box ml="auto">
            <RerunTest testId={record.test} />
          </Box>
        </HStack>
      </Stack>
      <Box flex="1" minH="0" overflowY="auto" px="3" py="3">
        <Box role="list" display="grid" gap="0.5" aria-label="Steps">
          {body.map((step, at) => (
            <StepLine
              key={step.index}
              step={step}
              current={step.index === playing}
              switched={switchedTo(body, at)}
              moves={tabMovesBefore(body, at, view.replay.tabMarks)}
              playback={playback}
            />
          ))}
        </Box>
        {checks.length > 0 ? (
          <ChecksSection steps={checks} playing={playing} playback={playback} />
        ) : null}
      </Box>
      <Stack gap="3" px="5" py="4" boxShadow="inset 0 1px 0 {colors.hairline}">
        {warnings.length > 0 ? (
          <Stack gap="1" maxH="9rem" overflowY="auto" aria-label="Warnings">
            {warnings.map((warning, i) => (
              <HStack key={i} gap="2" alignItems="flex-start" fontSize="1">
                <Icons.warn size={13} color={WARNING_TONE[warning.kind]} flexShrink="0" mt="0.5" />
                <Span color={WARNING_TONE[warning.kind]} overflowWrap="anywhere">
                  {warning.text}
                </Span>
              </HStack>
            ))}
          </Stack>
        ) : null}
        <HStack justify="space-between" gap="2" flexWrap="wrap">
          {view.page ? (
            <CopyFix test={record.test} page={view.page} verdict={record.verdict} />
          ) : (
            <Span />
          )}
          <Feedback dir={view.dir} />
        </HStack>
      </Stack>
    </Stack>
  )
}
