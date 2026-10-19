import type { LiveCall, LiveDelivery, LiveStep } from "@danwo/runner/runner"
import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { Heading, Span } from "@danwo/ui/primitives/typography"
import { Link, useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { Ident } from "../../components/code.tsx"
import { Page } from "../../components/page.tsx"
import {
  Item,
  ListRow,
  ListRows,
  None,
  Section,
  StatCard,
  StatCards,
} from "../../components/panel.tsx"
import { StatusBadge, Swatch, VerdictBadge } from "../../components/status-badge.tsx"
import { TimeAgo } from "../../components/time-ago.tsx"
import { dollars, duration } from "../../lib/format.ts"
import { toneOf } from "../../lib/verdicts.ts"
import {
  type LiveAttempt,
  type LiveView,
  progressOf,
  runningAttempts,
  stateWord,
} from "./live-values.ts"
import { CancelRun } from "./run-actions.tsx"
import { useLiveRun, useRunInTab } from "./use-live.ts"

/** Steps and calls an attempt card shows, the latest ones. */
const SHOWN = 6

/** The time now, ticking each second while `ticking`. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!ticking) return undefined

    const timer = setInterval(() => setNow(Date.now()), 1_000)

    return () => clearInterval(timer)
  }, [ticking])

  return now
}

/** A dot that breathes while something runs. */
const Pulse = styled("span", {
  base: {
    position: "relative",
    display: "inline-flex",
    w: "2",
    h: "2",
    flexShrink: "0",
    "&::before": {
      content: '""',
      position: "absolute",
      inset: "0",
      rounded: "full",
      bg: "verdict.notJudged.solid",
      animation: "ping",
      opacity: "0.6",
    },
    "&::after": {
      content: '""',
      position: "absolute",
      inset: "0",
      rounded: "full",
      bg: "verdict.notJudged.solid",
    },
  },
})

/** The run's state as a badge; a running one breathes. */
export function LiveBadge({ word }: { readonly word: string }) {
  if (word !== "running") return <StatusBadge status={word} />

  return (
    <VerdictBadge tone="notJudged" data-status="running">
      <Pulse aria-hidden="true" />
      running
    </VerdictBadge>
  )
}

function StepMark({ step }: { readonly step: LiveStep }) {
  if (step.status === "running") return <Pulse aria-label="running" />

  return <Swatch tone={toneOf(step.status)} w="2" h="2" rounded="full" aria-label={step.status} />
}

function StepLine({ step }: { readonly step: LiveStep }) {
  return (
    <Stack role="listitem" gap="0.5" minW="0">
      <HStack gap="2" minW="0">
        <StepMark step={step} />
        <Span overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap" title={step.label}>
          {step.label}
        </Span>
        <Span ml="auto" color="ink.muted" fontSize="1" fontVariantNumeric="tabular-nums">
          {step.status === "running" ? "…" : duration(step.durationMs)}
        </Span>
      </HStack>
      {step.actions.length > 0 ? (
        <Span pl="4" color="ink.muted" fontSize="1" lineClamp="2">
          {step.actions.join(" · ")}
        </Span>
      ) : null}
      {step.error ? (
        <Span pl="4" color="verdict.failed.fg" fontSize="1" lineClamp="2">
          {step.error}
        </Span>
      ) : null}
    </Stack>
  )
}

function CallLine({ call }: { readonly call: LiveCall }) {
  const failed = call.status === null || call.status >= 400

  return (
    <HStack role="listitem" gap="2" minW="0" fontSize="1">
      <Ident color={failed ? "verdict.failed.fg" : "ink.soft"} w="2.5rem" flexShrink="0">
        {call.status ?? "–"}
      </Ident>
      <Ident
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        title={`${call.method} ${call.host}${call.path}`}
      >
        {call.method} {call.host}
        {call.path}
      </Ident>
      {call.fault ? (
        <VerdictBadge tone="flaky" ml="auto" flexShrink="0">
          {call.fault}
        </VerdictBadge>
      ) : null}
    </HStack>
  )
}

function DeliveryLine({ delivery }: { readonly delivery: LiveDelivery }) {
  return (
    <HStack role="listitem" gap="2" minW="0" fontSize="1">
      <Ident
        color={delivery.delivered ? "ink.soft" : "verdict.failed.fg"}
        w="2.5rem"
        flexShrink="0"
      >
        {delivery.status ?? "–"}
      </Ident>
      <Ident overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
        {delivery.service ? `${delivery.service} ` : ""}
        {delivery.topic}
      </Ident>
      {delivery.fault ? (
        <VerdictBadge tone="flaky" ml="auto" flexShrink="0">
          {delivery.fault}
        </VerdictBadge>
      ) : null}
    </HStack>
  )
}

/** A small heading over one of an attempt card's lists. */
function ListHead({ children }: { readonly children: string }) {
  return (
    <Heading as="h3" color="ink.muted" fontSize="1" fontWeight="500" mb="1">
      {children}
    </Heading>
  )
}

/** One attempt as it runs: its latest steps on the left, the calls and webhooks behind them on the right. */
function AttemptCard({ attempt, now }: { readonly attempt: LiveAttempt; readonly now: number }) {
  const behind = attempt.calls.slice(-SHOWN).toReversed()

  return (
    <Item px="4" py="3.5" data-attempt={attempt.key}>
      <HStack gap="2" mb="3" flexWrap="wrap">
        <Pulse aria-hidden="true" />
        <Span fontWeight="500" overflowWrap="anywhere">
          {attempt.test}
        </Span>
        <Ident color="ink.muted" fontSize="1">
          {attempt.attempt}
        </Ident>
        <Span ml="auto" color="ink.muted" fontSize="1" fontVariantNumeric="tabular-nums">
          {duration(now - Date.parse(attempt.startedAt))}
        </Span>
      </HStack>
      <Grid gridTemplateColumns={{ base: "1fr", lg: "minmax(0, 3fr) minmax(0, 2fr)" }} gap="4">
        <Box minW="0">
          <ListHead>Steps</ListHead>
          {attempt.steps.length === 0 ? (
            <None>Starting…</None>
          ) : (
            <Stack role="list" gap="2" aria-label="Steps so far">
              {attempt.steps.slice(-SHOWN).map((step) => (
                <StepLine key={step.index} step={step} />
              ))}
            </Stack>
          )}
        </Box>
        <Stack gap="3" minW="0">
          <Box>
            <ListHead>{`Provider calls (${attempt.calls.length})`}</ListHead>
            <Stack role="list" gap="1" aria-label="Provider calls so far">
              {behind.map((call) => (
                <CallLine key={call.id} call={call} />
              ))}
            </Stack>
          </Box>
          {attempt.deliveries.length > 0 ? (
            <Box>
              <ListHead>{`Webhooks (${attempt.deliveries.length})`}</ListHead>
              <Stack role="list" gap="1" aria-label="Webhooks so far">
                {attempt.deliveries.slice(-SHOWN).map((delivery, i) => (
                  <DeliveryLine key={`${delivery.topic} ${i}`} delivery={delivery} />
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      </Grid>
    </Item>
  )
}

/** The tests (or trials) that finished, newest first. */
function Finished({ view }: { readonly view: LiveView }) {
  if (view.done.length === 0) return <None>Nothing has finished yet.</None>

  return (
    <ListRows aria-label="Finished">
      {view.done.toReversed().map((item, i) => (
        <ListRow key={`${item.name} ${i}`} display="flex" alignItems="center" gap="3">
          <Box w="8rem" flexShrink="0">
            <StatusBadge status={item.status} />
          </Box>
          <Ident overflowWrap="anywhere">{item.name}</Ident>
        </ListRow>
      ))}
    </ListRows>
  )
}

/** The four figures at the top: how far along, what failed, how long, what it spent. */
function LiveFigures({ view, now }: { readonly view: LiveView; readonly now: number }) {
  const progress = progressOf(view)
  const elapsed = view.durationMs ?? now - Date.parse(view.startedAt)
  const noun = view.kind === "matrix" ? "trials" : "tests"

  return (
    <StatCards>
      <StatCard
        label="Done"
        icon={<Icons.checkCircle size={13} />}
        value={`${progress.done} of ${view.planned}`}
        sub={
          progress.left > 0
            ? `${progress.left} ${noun} to go`
            : `every ${noun.slice(0, -1)} reported`
        }
      />
      <StatCard
        label="Failed"
        icon={<Icons.closeCircle size={13} />}
        value={progress.failed}
        sub={progress.failed === 0 ? "none so far" : `of ${progress.done} finished`}
      />
      <StatCard
        label="Elapsed"
        icon={<Icons.clock size={13} />}
        value={duration(elapsed)}
        sub={view.kind === "matrix" ? "danwo matrix" : "danwo test"}
      />
      <StatCard
        label="Model spend"
        icon={<Icons.dollar size={13} />}
        value={dollars(view.usd)}
        sub={view.usd === 0 ? "no model calls yet" : "so far"}
      />
    </StatCards>
  )
}

/** Why a run that stopped has no results. */
function Stopped() {
  return (
    <Stack
      gap="1"
      bg="verdict.failed.bg"
      rounded="14px"
      px="4"
      py="3.5"
      mb="2"
      aria-label="Run stopped"
    >
      <HStack gap="2" fontWeight="600" color="verdict.failed.fg">
        <Icons.warn size={14} />
        This run stopped before it finished
      </HStack>
      <Span color="ink.soft">
        Its process went away without a result: it was cancelled, or it crashed. What finished
        before is below.
      </Span>
    </Stack>
  )
}

/**
 * A run as it happens: its figures, each attempt running with its latest steps and calls, and
 * what finished. When the run ends the page becomes the run's ordinary page.
 */
export function LiveRunPage({ initial }: { readonly initial: LiveView }) {
  const view = useLiveRun(initial.id, initial) ?? initial
  const router = useRouter()
  const word = stateWord(view)
  const now = useNow(view.state === "running")
  const running = runningAttempts(view)

  useRunInTab(word, view.title)
  useEffect(() => {
    if (view.state === "finished") void router.invalidate()
  }, [view.state, router])

  return (
    <Page
      crumbs={[<Link to="/runs">Runs</Link>, view.title]}
      title={view.title}
      detail={
        <HStack gap="2" flexWrap="wrap" mt="1">
          <LiveBadge word={word} />
          <Ident>danwo {view.kind}</Ident>
          <span>
            started <TimeAgo at={view.startedAt} />
          </span>
        </HStack>
      }
      actions={view.state === "running" ? <CancelRun runId={view.id} /> : undefined}
    >
      {view.state === "stopped" ? <Stopped /> : null}
      <LiveFigures view={view} now={now} />
      <Section title="Running now" count={running.length}>
        {running.length === 0 ? (
          <None>{view.state === "running" ? "Starting the workers…" : "Nothing is running."}</None>
        ) : (
          <Stack gap="2">
            {running.map((attempt) => (
              <AttemptCard key={attempt.key} attempt={attempt} now={now} />
            ))}
          </Stack>
        )}
      </Section>
      <Section title="Finished" count={view.done.length}>
        <Finished view={view} />
      </Section>
    </Page>
  )
}
