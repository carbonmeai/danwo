import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack } from "@danwo/ui/jsx"
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
import { duration } from "../../lib/format.ts"
import { toneOf } from "../../lib/verdicts.ts"
import { RerunTest } from "../live/run-actions.tsx"
import type { RecordView } from "../record/record-data.ts"
import { clock, stepAt } from "../record/record-replay.ts"
import type { Playback } from "../record/use-playback.ts"
import { sendFeedback } from "./feedback-api.ts"
import { type Warning, fixPrompt, transcriptOf, warningsOf } from "./overlay-values.ts"

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
function CopyFix({ test, page }: { readonly test: string; readonly page: string }) {
  const [copied, copy] = useCopied("Prompt copied")
  const [, copyPage] = useCopied("Failure page copied")

  return (
    <ButtonGroup role="group" aria-label="Copy the failure">
      <Button variant="solid" size="sm" onClick={() => copy(fixPrompt(test, page))}>
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
          <DropdownMenuItem gap="2" onSelect={() => copy(fixPrompt(test, page))}>
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
            style={{ transform: each === "down" ? "rotate(180deg)" : undefined }}
          >
            <Icons.thumbsUp size={14} />
          </Box>
        </Button>
      ))}
    </HStack>
  )
}

/** One step of the transcript: its number, what it did, and a jump to it in the replay. */
function StepLine({
  step,
  current,
  playback,
}: {
  readonly step: ReturnType<typeof transcriptOf>[number]
  readonly current: boolean
  readonly playback: Playback | undefined
}) {
  const failed = toneOf(step.status) === "failed"

  return (
    <Box
      role="listitem"
      display="grid"
      gridTemplateColumns="1.75rem minmax(0, 1fr)"
      gap="2"
      px="2"
      py="2"
      rounded="lg"
      bg={current ? "surface.active" : undefined}
      aria-current={current ? "step" : undefined}
    >
      <Span
        display="grid"
        placeItems="center"
        h="6"
        w="6"
        rounded="full"
        fontSize="1"
        fontWeight="600"
        bg={failed ? "verdict.failed.bg" : "surface.hover"}
        color={failed ? "verdict.failed.fg" : "ink.soft"}
      >
        {step.index + 1}
      </Span>
      <Stack gap="1" minW="0">
        <Span fontWeight="500" overflowWrap="anywhere">
          {step.label}
        </Span>
        <HStack gap="2" color="ink.muted" fontSize="1" flexWrap="wrap">
          {playback && step.atMs !== undefined ? (
            <Button
              variant="soft"
              size="xs"
              h="5"
              px="1.5"
              aria-label={`Go to step ${step.index + 1}, at ${clock(step.atMs - playback.startMs)}`}
              onClick={() => playback.seek(step.atMs ?? 0)}
            >
              <Icons.play size={10} />
              {clock(step.atMs - playback.startMs)}
            </Button>
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
          <StatusBadge status={record.status} />
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
          {steps.map((step) => (
            <StepLine
              key={step.index}
              step={step}
              current={step.index === playing}
              playback={playback}
            />
          ))}
        </Box>
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
          {view.page ? <CopyFix test={record.test} page={view.page} /> : <Span />}
          <Feedback dir={view.dir} />
        </HStack>
      </Stack>
    </Stack>
  )
}
