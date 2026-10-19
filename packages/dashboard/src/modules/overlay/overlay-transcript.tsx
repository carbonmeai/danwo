import { Icons } from "@danwo/ui/icons/base"
import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import { useState } from "react"

import { Button } from "../../components/controls.tsx"
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

/** Copies the failure as a prompt for a coding agent, or the failure page itself as Markdown. */
function CopyFix({ test, page }: { readonly test: string; readonly page: string }) {
  const [copied, copy] = useCopied()

  return (
    <HStack gap="0.5">
      <Button type="button" look="primary" onClick={() => copy(fixPrompt(test, page))}>
        {copied ? <Icons.copyCheck size={14} /> : <Icons.aiStar size={14} />}
        <span aria-live="polite">{copied ? "Copied" : "Copy prompt to fix"}</span>
      </Button>
      <styled.details position="relative">
        <styled.summary
          listStyle="none"
          cursor="pointer"
          display="grid"
          placeItems="center"
          h="8"
          w="7"
          rounded="lg"
          bg="surface.hover"
          aria-label="More ways to copy"
          css={{ "&::-webkit-details-marker": { display: "none" } }}
        >
          <Icons.caretDown size={12} />
        </styled.summary>
        <Stack
          position="absolute"
          bottom="10"
          right="0"
          zIndex="2"
          minW="13rem"
          p="1"
          gap="0.5"
          bg="surface.pop"
          boxShadow="pop"
          rounded="lg"
        >
          <Button type="button" look="ghost" justifyContent="flex-start" onClick={() => copy(page)}>
            Copy the failure page (Markdown)
          </Button>
          <Button
            type="button"
            look="ghost"
            justifyContent="flex-start"
            onClick={() => copy(fixPrompt(test, page))}
          >
            Copy prompt to fix
          </Button>
        </Stack>
      </styled.details>
    </HStack>
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
    <HStack gap="0.5" color="ink.muted" aria-label="Was this useful?">
      {(["up", "down"] as const).map((each) => (
        <Button
          key={each}
          type="button"
          look="ghost"
          w="8"
          px="0"
          aria-pressed={vote === each}
          aria-label={each === "up" ? "Useful" : "Not useful"}
          color={vote === each ? "ink.strong" : undefined}
          onClick={() => send(each)}
        >
          {each === "up" ? "👍" : "👎"}
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
    <styled.li
      display="grid"
      gridTemplateColumns="1.75rem minmax(0, 1fr)"
      gap="2"
      px="2"
      py="2"
      rounded="lg"
      bg={current ? "surface.active" : undefined}
      aria-current={current ? "step" : undefined}
    >
      <styled.span
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
      </styled.span>
      <Stack gap="1" minW="0">
        <styled.span fontWeight="500" overflowWrap="anywhere">
          {step.label}
        </styled.span>
        <HStack gap="2" color="ink.muted" fontSize="1" flexWrap="wrap">
          {playback && step.atMs !== undefined ? (
            <styled.button
              type="button"
              display="inline-flex"
              alignItems="center"
              gap="1"
              px="1.5"
              h="5"
              rounded="md"
              bg="surface.hover"
              color="ink.soft"
              cursor="pointer"
              _hover={{ color: "ink.strong" }}
              aria-label={`Go to step ${step.index + 1}, at ${clock(step.atMs - playback.startMs)}`}
              onClick={() => playback.seek(step.atMs ?? 0)}
            >
              <Icons.play size={10} />
              {clock(step.atMs - playback.startMs)}
            </styled.button>
          ) : null}
          <span>{step.api}</span>
          {step.cache ? <span>cache: {step.cache}</span> : null}
          <span>{duration(step.durationMs)}</span>
        </HStack>
        {step.error ? (
          <styled.span color="verdict.failed.fg" fontSize="1" overflowWrap="anywhere">
            {step.error}
          </styled.span>
        ) : null}
      </Stack>
    </styled.li>
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
      <Stack gap="2" px="5" pt="5" pb="4" boxShadow="inset 0 -1px 0 {colors.hairline}">
        <HStack justify="space-between" gap="3" alignItems="flex-start">
          <styled.h2 fontSize="2" fontWeight="600" overflowWrap="anywhere" id="overlay-title">
            {record.test}
          </styled.h2>
          <StatusBadge status={record.status} />
        </HStack>
        <HStack gap="3" color="ink.muted" fontSize="1" flexWrap="wrap">
          <span>{new Date(record.startedAt).toLocaleString()}</span>
          <span>{duration(record.durationMs)}</span>
          {record.run.kind === "matrix" ? (
            <span>matrix: {record.run.fault?.label ?? "clean run"}</span>
          ) : record.run.attempt > 1 ? (
            <span>retry {record.run.attempt - 1}</span>
          ) : null}
          <Box ml="auto">
            <RerunTest testId={record.test} look="grey" />
          </Box>
        </HStack>
      </Stack>
      <Box flex="1" minH="0" overflowY="auto" px="3" py="3">
        <styled.ol display="grid" gap="0.5" aria-label="Steps">
          {steps.map((step) => (
            <StepLine
              key={step.index}
              step={step}
              current={step.index === playing}
              playback={playback}
            />
          ))}
        </styled.ol>
      </Box>
      <Stack gap="3" px="5" py="4" boxShadow="inset 0 1px 0 {colors.hairline}">
        {warnings.length > 0 ? (
          <Stack gap="1" maxH="9rem" overflowY="auto" aria-label="Warnings">
            {warnings.map((warning, i) => (
              <HStack key={i} gap="2" alignItems="flex-start" fontSize="1">
                <Icons.warn size={13} color={WARNING_TONE[warning.kind]} flexShrink="0" mt="0.5" />
                <styled.span color={WARNING_TONE[warning.kind]} overflowWrap="anywhere">
                  {warning.text}
                </styled.span>
              </HStack>
            ))}
          </Stack>
        ) : null}
        <HStack justify="space-between" gap="2" flexWrap="wrap">
          {view.page ? <CopyFix test={record.test} page={view.page} /> : <span />}
          <Feedback dir={view.dir} />
        </HStack>
      </Stack>
    </Stack>
  )
}
