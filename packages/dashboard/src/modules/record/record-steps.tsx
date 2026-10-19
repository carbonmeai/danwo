import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { useEffect, useRef, useState } from "react"

import { None } from "../../components/panel.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { Row, RowList, RowPanel } from "../../components/table.tsx"
import { duration } from "../../lib/format.ts"
import { useListKeys } from "../../lib/list-keys.ts"
import type { RecordView, StepView } from "./record-data.ts"
import { Cache, StepDetail } from "./step-detail.tsx"
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

function StepLine({
  dir,
  step,
  picked,
  longest,
  onPick,
}: {
  readonly dir: string
  readonly step: StepView
  readonly picked: boolean
  readonly longest: number
  readonly onPick: (step: StepView) => void
}) {
  return (
    <Row data-row data-picked={picked || undefined} p="0">
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
    </Row>
  )
}

/** The run's steps down the left, j and k moving through them, the picked one in full on the right. */
export function RecordSteps({ view }: { readonly view: RecordView }) {
  const failedStep = view.steps.find((s) => s.status !== "passed")
  const [picked, setPicked] = useState<StepView | undefined>(failedStep ?? view.steps.at(-1))
  const list = useRef<HTMLUListElement>(null)
  const current = useListKeys(list, view.steps.length)
  const longest = Math.max(...view.steps.map((s) => s.durationMs), 1)

  useEffect(() => {
    const step = view.steps[current]

    if (step) setPicked(step)
  }, [current, view.steps])

  if (view.steps.length === 0) return <None>This run recorded no steps.</None>

  return (
    <Grid
      gridTemplateColumns={{ base: "1fr", lg: "minmax(0, 3fr) minmax(0, 2fr)" }}
      gap="2"
      alignItems="start"
    >
      <RowPanel pt="1.5">
        <RowList ref={list} aria-label="Step list">
          {view.steps.map((step) => (
            <StepLine
              key={step.index}
              dir={view.dir}
              step={step}
              picked={step === picked}
              longest={longest}
              onPick={setPicked}
            />
          ))}
        </RowList>
      </RowPanel>
      {picked ? <StepDetail dir={view.dir} step={picked} /> : null}
    </Grid>
  )
}
