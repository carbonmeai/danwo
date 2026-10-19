import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"

import { Ident, Pre } from "../../components/code.tsx"
import { Panel } from "../../components/panel.tsx"
import { StatusBadge } from "../../components/status-badge.tsx"
import { duration } from "../../lib/format.ts"
import type { StepView } from "./record-data.ts"
import type { EffectLine } from "./record-effects.ts"
import { CACHE_WORDS, cacheTone, SEEN } from "./record-values.ts"
import { useScreenshot } from "./use-screenshot.ts"

const CacheTag = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    h: "18px",
    px: "1.5",
    rounded: "6px",
    fontSize: "0.688",
    fontWeight: "500",
    whiteSpace: "nowrap",
  },
  variants: {
    tone: {
      hit: { bg: "verdict.passed.bg", color: "verdict.passed.fg" },
      partial: { bg: "verdict.flaky.bg", color: "verdict.flaky.fg" },
      miss: { bg: "surface.hover", color: "ink.muted" },
      bad: { bg: "verdict.failed.bg", color: "verdict.failed.fg" },
    },
  },
})

/** How the replay cache answered a step, as a tiny tag. */
export function Cache({ mode }: { readonly mode: string }) {
  return (
    <CacheTag
      tone={cacheTone(mode)}
      data-cache={mode}
      title="How the replay cache answered this step"
    >
      {CACHE_WORDS[mode] ?? mode}
    </CacheTag>
  )
}

/** The effects the recording expected against what the replay did. */
function EffectsDiff({ lines }: { readonly lines: readonly EffectLine[] }) {
  if (lines.length === 0)
    return <Box color="ink.muted">Neither the recording nor the replay changed anything.</Box>

  return (
    <styled.ul aria-label="Effects" fontFamily="mono" fontSize="1" display="grid" gap="2px">
      {lines.map((line) => {
        const seen = SEEN[line.seen]

        return (
          <styled.li
            key={`${line.area} ${line.text}`}
            display="grid"
            gridTemplateColumns="1.25rem 4.5rem minmax(0, 1fr) auto"
            gap="2"
            px="2"
            py="1"
            rounded="6px"
            bg={
              line.seen === "expected"
                ? "verdict.failed.bg"
                : line.seen === "observed"
                  ? "verdict.flaky.bg"
                  : "surface.panel"
            }
          >
            <styled.span color={seen.color} aria-hidden="true">
              {seen.mark}
            </styled.span>
            <styled.span color="ink.muted">{line.area}</styled.span>
            <styled.span overflowWrap="anywhere">{line.text}</styled.span>
            <styled.span color={seen.color} fontFamily="sans">
              {seen.word}
            </styled.span>
          </styled.li>
        )
      })}
    </styled.ul>
  )
}

function Shot({ dir, file }: { readonly dir: string; readonly file: string }) {
  const { src } = useScreenshot(dir, file, false)

  return src === undefined ? (
    <Box
      h="12rem"
      rounded="lg"
      bg="surface.track"
      animation="pulsate"
      aria-label="Loading the screenshot"
    />
  ) : (
    <styled.img
      src={src}
      alt={`Screenshot after the step (${file})`}
      maxW="full"
      rounded="lg"
      boxShadow="chip"
    />
  )
}

/** The picked step in full: its verdict, what the cache did, any error and effects, and its screenshot. */
export function StepDetail({ dir, step }: { readonly dir: string; readonly step: StepView }) {
  return (
    <Panel data-step={step.index} position={{ lg: "sticky" }} top="16">
      <Stack gap="4" bg="surface.item" rounded="10px" p="4">
        <Stack gap="2">
          <HStack gap="2" flexWrap="wrap">
            <StatusBadge status={step.status} />
            {step.cache ? <Cache mode={step.cache} /> : null}
            <styled.span color="ink.muted" fontSize="1">
              {duration(step.durationMs)}
            </styled.span>
          </HStack>
          <styled.h3 fontSize="2" fontWeight="600" overflowWrap="anywhere">
            Step {step.index}: {step.label}
          </styled.h3>
          <HStack gap="3" color="ink.muted" fontSize="1" flexWrap="wrap">
            <Ident>{step.api}</Ident>
            {step.source ? <Ident>{step.source}</Ident> : null}
          </HStack>
        </Stack>
        {step.cacheDetail ? <Box color="ink.muted">Replay cache: {step.cacheDetail}</Box> : null}
        {step.error ? (
          <Pre color="verdict.failed.fg" bg="verdict.failed.bg">
            {step.error}
          </Pre>
        ) : null}
        {step.effectDiff ? (
          <Stack gap="2">
            <HStack gap="2" fontWeight="500">
              <span>Effects</span>
              {step.effectResult ? <StatusBadge status={step.effectResult} /> : null}
            </HStack>
            {step.effects?.[0] ? (
              <Box color="ink.muted" fontSize="1">
                {step.effects[0]}
              </Box>
            ) : null}
            <EffectsDiff lines={step.effectDiff} />
          </Stack>
        ) : null}
        {step.screenshot ? <Shot dir={dir} file={step.screenshot} /> : null}
      </Stack>
    </Panel>
  )
}
