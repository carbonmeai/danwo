import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { Button } from "../../components/controls.tsx"
import { None } from "../../components/panel.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { Row, RowList, RowPanel } from "../../components/table.tsx"
import { duration } from "../../lib/format.ts"
import { useListKeys } from "../../lib/list-keys.ts"
import type { RecordView, StepView } from "./record-data.ts"
import { clock, stepAt } from "./record-replay.ts"
import { Cache, StepDetail } from "./step-detail.tsx"
import type { Playback } from "./use-playback.ts"
import { useScreenshot } from "./use-screenshot.ts"

function Thumb({ dir, step }: { readonly dir: string; readonly step: StepView }) {
  const { src, ref } = useScreenshot(dir, step.screenshot, true)

  return (
    <Box
      ref={ref}
      w="5rem"
      h="3.25rem"
      flexShrink="0"
      rounded="6px"
      overflow="hidden"
      bg="surface.track"
      boxShadow="chip"
    >
      {src ? (
        <styled.img
          src={src}
          alt={`After step ${step.index}`}
          w="full"
          h="full"
          objectFit="cover"
          objectPosition="top"
        />
      ) : null}
    </Box>
  )
}

/** Seeks the player to where a step starts. */
function GoTo({
  step,
  startMs,
  playback,
}: {
  readonly step: number
  readonly startMs: number
  readonly playback: Playback
}) {
  return (
    <Button
      type="button"
      look="ghost"
      h="7"
      px="2"
      fontSize="1"
      flexShrink="0"
      aria-label={`Go to step ${step}, at ${clock(startMs - playback.startMs)}`}
      onClick={() => playback.seek(startMs)}
    >
      <Icons.play size={12} />
      {clock(startMs - playback.startMs)}
    </Button>
  )
}

function StepLine({
  dir,
  step,
  picked,
  playing,
  longest,
  onPick,
  goTo,
}: {
  readonly dir: string
  readonly step: StepView
  readonly picked: boolean
  /** The player is at this step. */
  readonly playing: boolean
  readonly longest: number
  readonly onPick: (step: StepView) => void
  readonly goTo?: ReactNode
}) {
  return (
    <Row
      data-row
      data-picked={picked || undefined}
      aria-current={playing ? "step" : undefined}
      id={`step-${step.index}`}
      p="0"
      display="flex"
      alignItems="center"
      pr={goTo ? "2" : "0"}
      {...(playing && { boxShadow: "inset 2px 0 0 {colors.series.1}" })}
    >
      <styled.button
        type="button"
        onClick={() => onPick(step)}
        aria-pressed={picked}
        display="grid"
        gridTemplateColumns="1.5rem auto minmax(0, 1fr) auto"
        gap="3"
        alignItems="center"
        w="full"
        textAlign="left"
        px="3"
        py="2"
        cursor="pointer"
      >
        <styled.span
          color="ink.faint"
          fontSize="1"
          textAlign="right"
          fontVariantNumeric="tabular-nums"
        >
          {step.index}
        </styled.span>
        {step.screenshot ? <Thumb dir={dir} step={step} /> : <Box w="5rem" />}
        <Stack gap="1.5" minW="0">
          <styled.span
            fontWeight="500"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
          >
            {step.label}
          </styled.span>
          <HStack gap="2">
            <Box flex="1" h="1" bg="surface.track" rounded="full" maxW="12rem">
              <Box
                h="full"
                rounded="full"
                bg={step.status === "passed" ? "series.1" : "verdict.failed.solid"}
                style={{ width: `${Math.max((step.durationMs / longest) * 100, 2)}%` }}
              />
            </Box>
            <styled.span color="ink.muted" fontSize="1">
              {duration(step.durationMs)}
            </styled.span>
          </HStack>
        </Stack>
        <HStack gap="2" justify="flex-end">
          {step.cache ? <Cache mode={step.cache} /> : null}
          {step.status === "passed" ? null : <StatusBadge status={step.status} />}
        </HStack>
      </styled.button>
      {goTo}
    </Row>
  )
}

/** Where each step starts on the player's clock, by step index. */
function stepStarts(playback: Playback | undefined): ReadonlyMap<number, number> {
  return new Map(
    (playback?.marks ?? []).flatMap((mark) =>
      mark.kind === "step" && mark.step !== undefined ? [[mark.step, mark.atMs] as const] : [],
    ),
  )
}

/**
 * The run's steps down the left, j and k moving through them, the picked one in full on the right.
 * With a player, each step can seek it, and the step it is at is marked and followed while it plays.
 */
export function RecordSteps({
  view,
  playback,
}: {
  readonly view: RecordView
  readonly playback?: Playback | undefined
}) {
  const failedStep = view.steps.find((s) => s.status !== "passed")
  const [picked, setPicked] = useState<StepView | undefined>(failedStep ?? view.steps.at(-1))
  const list = useRef<HTMLUListElement>(null)
  const current = useListKeys(list, view.steps.length)
  const longest = Math.max(...view.steps.map((s) => s.durationMs), 1)
  const starts = stepStarts(playback)
  const playingStep = playback && stepAt(playback.marks, playback.ms)

  useEffect(() => {
    const step = view.steps[current]

    if (step) setPicked(step)
  }, [current, view.steps])

  /* While the run plays, the detail follows the step on screen. */
  useEffect(() => {
    if (playback?.playing !== true) return

    const step = view.steps.find((s) => s.index === playingStep)

    if (step) setPicked(step)
  }, [playback?.playing, playingStep, view.steps])

  if (view.steps.length === 0) return <None>This run recorded no steps.</None>

  return (
    <Grid
      gridTemplateColumns={{ base: "1fr", lg: "minmax(0, 3fr) minmax(0, 2fr)" }}
      gap="2"
      alignItems="start"
    >
      <RowPanel pt="1.5">
        <RowList ref={list} aria-label="Step list">
          {view.steps.map((step) => {
            const start = starts.get(step.index)

            return (
              <StepLine
                key={step.index}
                dir={view.dir}
                step={step}
                picked={step === picked}
                playing={playingStep === step.index}
                longest={longest}
                onPick={setPicked}
                goTo={
                  playback && start !== undefined ? (
                    <GoTo step={step.index} startMs={start} playback={playback} />
                  ) : undefined
                }
              />
            )
          })}
        </RowList>
      </RowPanel>
      {picked ? <StepDetail dir={view.dir} step={picked} /> : null}
    </Grid>
  )
}
