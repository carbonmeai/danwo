import type { RecordedExchange } from "@danwo/runner/runner"
import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { MarkdownDocument } from "@danwo/ui/primitives/markdown"
import { createFileRoute, Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { fetchRecord, fetchScreenshot } from "../api.ts"
import { ago, duration, when } from "../components/format.ts"
import { useListKeys } from "../components/keys.ts"
import {
  Empty,
  Ident,
  KeyHint,
  PageTitle,
  Panel,
  Section,
  StatusBadge,
} from "../components/status.tsx"
import type { EffectLine } from "../data/effects.ts"
import type { RecordView, StepView } from "../data/records.ts"
import { type Lane, lanesOf, type Timeline, type TimelineItem } from "../data/timeline.ts"

export const Route = createFileRoute("/records/$")({
  loader: ({ params }) => fetchRecord({ data: params._splat ?? "" }),
  component: RecordPage,
})

const Pre = styled("pre", {
  base: {
    fontFamily: "mono",
    fontSize: "1",
    lineHeight: "1.6",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    bg: "signal.raised",
    borderWidth: "1px",
    borderColor: "signal.rule",
    p: "3",
    rounded: "md",
    maxH: "24rem",
    overflowY: "auto",
  },
})

/** Screenshots already fetched, by record folder and file, shared by thumbnails and the big view. */
const shots = new Map<string, Promise<string>>()

function screenshot(dir: string, file: string): Promise<string> {
  const key = `${dir}\n${file}`
  const known = shots.get(key)

  if (known) return known

  const loading = fetchScreenshot({ data: { dir, file } })

  shots.set(key, loading)

  return loading
}

/** A step's screenshot as a data URL, fetched once the element scrolls near the viewport. */
function useShot(dir: string, file: string | undefined, lazy: boolean) {
  const [src, setSrc] = useState<string>()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    let observer: IntersectionObserver | undefined
    const load = (name: string) =>
      void screenshot(dir, name).then((url) => {
        if (live) setSrc(url)
      })

    setSrc(undefined)

    if (file !== undefined) {
      if (!lazy || typeof IntersectionObserver === "undefined") load(file)
      else {
        const watcher = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              watcher.disconnect()
              load(file)
            }
          },
          { rootMargin: "200px" },
        )

        if (ref.current) watcher.observe(ref.current)
        observer = watcher
      }
    }

    return () => {
      live = false
      observer?.disconnect()
    }
  }, [dir, file, lazy])

  return { src, ref }
}

function Thumb({ dir, step }: { readonly dir: string; readonly step: StepView }) {
  const { src, ref } = useShot(dir, step.screenshot, true)

  return (
    <Box
      ref={ref}
      w="5rem"
      h="3.25rem"
      flexShrink="0"
      rounded="sm"
      overflow="hidden"
      bg="signal.raised"
      borderWidth="1px"
      borderColor="signal.rule"
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

/** The cache outcome, as the badge words it. */
const CACHE_WORDS: Readonly<Record<string, string>> = {
  replayed: "replayed",
  relocated: "relocated",
  "handed-off": "handed off",
  missed: "model ran",
  stale: "stale",
  diverged: "diverged",
  off: "no cache",
}

const CacheTag = styled("span", {
  base: {
    fontSize: "1",
    px: "1.5",
    rounded: "sm",
    borderWidth: "1px",
    whiteSpace: "nowrap",
    lineHeight: "1.4",
  },
  variants: {
    tone: {
      hit: { borderColor: "verdict.passed.solid", color: "verdict.passed.fg" },
      partial: { borderColor: "verdict.flaky.solid", color: "verdict.flaky.fg" },
      miss: { borderColor: "signal.ruleStrong", color: "signal.quiet" },
      bad: { borderColor: "verdict.failed.solid", color: "verdict.failed.fg" },
    },
  },
})

function cacheTone(mode: string): "hit" | "partial" | "miss" | "bad" {
  if (mode === "replayed") return "hit"
  if (mode === "relocated" || mode === "handed-off" || mode === "stale") return "partial"

  return mode === "diverged" ? "bad" : "miss"
}

function Cache({ mode }: { readonly mode: string }) {
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

const SEEN: Readonly<Record<EffectLine["seen"], { mark: string; word: string; color: string }>> = {
  both: { mark: " ", word: "as recorded", color: "signal.quiet" },
  expected: { mark: "−", word: "missing", color: "verdict.failed.fg" },
  observed: { mark: "+", word: "new", color: "verdict.flaky.fg" },
}

/** The effects the recording expected against what the replay did. */
function EffectsDiff({ lines }: { readonly lines: readonly EffectLine[] }) {
  if (lines.length === 0)
    return (
      <Box color="signal.quiet" fontSize="1.5">
        Neither the recording nor the replay changed anything.
      </Box>
    )

  return (
    <styled.ul
      aria-label="Effects"
      fontFamily="mono"
      fontSize="1"
      rounded="md"
      borderWidth="1px"
      borderColor="signal.rule"
      overflow="hidden"
    >
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
            borderBottomWidth="1px"
            borderColor="signal.rule"
            bg={
              line.seen === "expected"
                ? "verdict.failed.bg"
                : line.seen === "observed"
                  ? "verdict.flaky.bg"
                  : undefined
            }
            _last={{ borderBottomWidth: "0" }}
          >
            <styled.span color={seen.color} aria-hidden="true">
              {seen.mark}
            </styled.span>
            <styled.span color="signal.quiet">{line.area}</styled.span>
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
  const { src } = useShot(dir, file, false)

  return src === undefined ? (
    <Box
      h="12rem"
      rounded="md"
      bg="signal.raised"
      animation="pulsate"
      aria-label="Loading the screenshot"
    />
  ) : (
    <styled.img
      src={src}
      alt={`Screenshot after the step (${file})`}
      maxW="full"
      rounded="md"
      borderWidth="1px"
      borderColor="signal.rule"
    />
  )
}

function StepDetail({ dir, step }: { readonly dir: string; readonly step: StepView }) {
  return (
    <Panel p="5" data-step={step.index} position={{ lg: "sticky" }} top="20">
      <Stack gap="4">
        <Stack gap="2">
          <HStack gap="2" flexWrap="wrap">
            <StatusBadge status={step.status} />
            {step.cache ? <Cache mode={step.cache} /> : null}
            <styled.span color="signal.quiet" fontSize="1">
              {duration(step.durationMs)}
            </styled.span>
          </HStack>
          <styled.h3 fontSize="3" fontWeight="600" overflowWrap="anywhere">
            Step {step.index}: {step.label}
          </styled.h3>
          <HStack gap="3" color="signal.quiet" fontSize="1" flexWrap="wrap">
            <Ident>{step.api}</Ident>
            {step.source ? <Ident>{step.source}</Ident> : null}
          </HStack>
        </Stack>
        {step.cacheDetail ? (
          <Box color="signal.quiet" fontSize="1.5">
            Replay cache: {step.cacheDetail}
          </Box>
        ) : null}
        {step.error ? <Pre color="verdict.failed.fg">{step.error}</Pre> : null}
        {step.effectDiff ? (
          <Stack gap="2">
            <HStack gap="2" fontSize="1.5" fontWeight="500">
              <span>Effects</span>
              {step.effectResult ? <StatusBadge status={step.effectResult} /> : null}
            </HStack>
            {step.effects?.[0] ? (
              <Box color="signal.quiet" fontSize="1">
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

function Steps({ view }: { readonly view: RecordView }) {
  const failedStep = view.steps.find((s) => s.status !== "passed")
  const [picked, setPicked] = useState<StepView | undefined>(failedStep ?? view.steps.at(-1))
  const list = useRef<HTMLOListElement>(null)
  const current = useListKeys(list, view.steps.length)
  const longest = Math.max(...view.steps.map((s) => s.durationMs), 1)

  useEffect(() => {
    const step = view.steps[current]

    if (step) setPicked(step)
  }, [current, view.steps])

  if (view.steps.length === 0) return <Box color="signal.quiet">This run recorded no steps.</Box>

  return (
    <Grid
      gridTemplateColumns={{ base: "1fr", lg: "minmax(0, 3fr) minmax(0, 2fr)" }}
      gap="5"
      alignItems="start"
    >
      <Panel overflow="hidden">
        <styled.ol ref={list} aria-label="Step list">
          {view.steps.map((step) => (
            <styled.li
              key={step.index}
              data-row
              data-picked={step === picked || undefined}
              borderBottomWidth="1px"
              borderColor="signal.rule"
              _last={{ borderBottomWidth: "0" }}
              css={{
                "&[data-picked]": {
                  bg: "signal.accentSoft",
                  boxShadow: "inset 3px 0 0 {colors.signal.accent}",
                },
              }}
            >
              <styled.button
                type="button"
                onClick={() => setPicked(step)}
                aria-pressed={step === picked}
                display="grid"
                gridTemplateColumns="2rem auto minmax(0, 1fr) auto"
                gap="3"
                alignItems="center"
                w="full"
                textAlign="left"
                px="4"
                py="2.5"
                cursor="pointer"
                _hover={{ bg: "signal.raised" }}
              >
                <styled.span color="signal.quiet" fontSize="1" textAlign="right">
                  {step.index}
                </styled.span>
                {step.screenshot ? <Thumb dir={view.dir} step={step} /> : <Box w="5rem" />}
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
                    <Box flex="1" h="1" bg="signal.raised" rounded="full" maxW="12rem">
                      <Box
                        h="full"
                        rounded="full"
                        bg={step.status === "passed" ? "signal.ruleStrong" : "verdict.failed.solid"}
                        style={{ width: `${Math.max((step.durationMs / longest) * 100, 2)}%` }}
                      />
                    </Box>
                    <styled.span color="signal.quiet" fontSize="1">
                      {duration(step.durationMs)}
                    </styled.span>
                  </HStack>
                </Stack>
                <HStack gap="2" justify="flex-end">
                  {step.cache ? <Cache mode={step.cache} /> : null}
                  {step.status === "passed" ? null : <StatusBadge status={step.status} />}
                </HStack>
              </styled.button>
            </styled.li>
          ))}
        </styled.ol>
      </Panel>
      {picked ? <StepDetail dir={view.dir} step={picked} /> : null}
    </Grid>
  )
}

/** The colour an HTTP status or outcome reads in. */
function statusColor(item: Pick<TimelineItem, "outcome" | "bad">): string {
  const code = Number(item.outcome)

  if (!Number.isFinite(code)) return item.bad ? "verdict.failed.fg" : "signal.quiet"
  if (code >= 500) return "verdict.failed.fg"
  if (code >= 400) return "verdict.flaky.fg"

  return code >= 300 ? "signal.quiet" : "verdict.passed.fg"
}

function KindMark({ kind }: { readonly kind: TimelineItem["kind"] }) {
  const words = { step: "Step", call: "Call", webhook: "Webhook" }

  return (
    <styled.span
      fontSize="1"
      color={kind === "step" ? "signal.ink" : "signal.accent"}
      fontWeight="500"
      w="4.5rem"
      flexShrink="0"
    >
      {words[kind]}
    </styled.span>
  )
}

const BAR_FILL = {
  step: "signal.ruleStrong",
  call: "signal.accent",
  webhook: "signal.accentSoft",
} as const

/** One call, webhook or step on the waterfall's track, with a diamond where a fault landed. */
function Bar({ item, span }: { readonly item: TimelineItem; readonly span: number }) {
  return (
    <>
      <Box
        position="absolute"
        top={item.kind === "step" ? "0" : "1"}
        bottom={item.kind === "step" ? "0" : "1"}
        rounded="sm"
        bg={item.bad ? "verdict.failed.solid" : BAR_FILL[item.kind]}
        borderWidth={item.kind === "webhook" && !item.bad ? "1.5px" : "0"}
        borderColor="signal.accent"
        style={{
          left: `${(item.startMs / span) * 100}%`,
          width: `max(3px, ${(item.durationMs / span) * 100}%)`,
        }}
      />
      {item.fault ? (
        <Box
          position="absolute"
          top="50%"
          w="2.5"
          h="2.5"
          bg="verdict.failed.solid"
          borderWidth="2px"
          borderColor="signal.panel"
          aria-label={`Fault: ${item.fault}`}
          role="img"
          style={{
            left: `${(item.startMs / span) * 100}%`,
            transform: "translate(-50%, -50%) rotate(45deg)",
          }}
        />
      ) : null}
    </>
  )
}

const TICKS = [0, 0.25, 0.5, 0.75, 1]
const TICK_SHIFT: Readonly<Record<number, string>> = { 0: "0", 1: "-100%" }
const LANE_COLUMNS = "minmax(16rem, 2fr) minmax(0, 5fr) 5rem"

/** How a lane's label is set: steps in the text face, calls and webhooks indented in mono. */
const LABEL_STYLE = {
  step: { fontFamily: "sans", fontSize: "1.5", fontWeight: "500" },
  call: { fontFamily: "mono", fontSize: "1", fontWeight: "400" },
  webhook: { fontFamily: "mono", fontSize: "1", fontWeight: "400" },
} as const

/** What a lane's right-hand column says: a step's time, or the worst status among its calls. */
function laneEnd(lane: Lane): { readonly text: string; readonly color: string } {
  const shown = lane.items.find((item) => item.bad) ?? lane.items[0]

  if (shown === undefined) return { text: "", color: "signal.quiet" }

  return {
    text: lane.kind === "step" ? duration(shown.durationMs) : shown.outcome,
    color: statusColor(shown),
  }
}

function LaneLabel({ lane }: { readonly lane: Lane }) {
  return (
    <HStack gap="2" minW="0" pl={lane.kind === "step" ? "0" : "3"}>
      <KindMark kind={lane.kind} />
      <styled.span
        {...LABEL_STYLE[lane.kind]}
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
      >
        {lane.label}
      </styled.span>
      {lane.items.length > 1 ? (
        <styled.span color="signal.quiet" fontSize="1" flexShrink="0">
          ×{lane.items.length}
        </styled.span>
      ) : null}
    </HStack>
  )
}

/** One row of the waterfall: its label, its bars on the shared clock, and how it ended. */
function LaneRow({
  lane,
  first,
  span,
}: {
  readonly lane: Lane
  readonly first: boolean
  readonly span: number
}) {
  const faults = lane.items.flatMap((item) => (item.fault ? [item.fault] : []))
  const end = laneEnd(lane)

  return (
    <Grid
      as="li"
      gridTemplateColumns={LANE_COLUMNS}
      columnGap="4"
      alignItems="center"
      py="1"
      borderTopWidth={lane.kind === "step" && !first ? "1px" : "0"}
      borderColor="signal.rule"
      data-kind={lane.kind}
      title={faults.length > 0 ? `Fault: ${faults.join(", ")}` : lane.label}
    >
      <LaneLabel lane={lane} />
      <Box position="relative" h="4" bg="signal.raised" rounded="sm">
        {TICKS.slice(1, -1).map((tick) => (
          <Box
            key={tick}
            position="absolute"
            top="0"
            bottom="0"
            w="1px"
            bg="signal.rule"
            style={{ left: `${tick * 100}%` }}
          />
        ))}
        {lane.items.map((item, j) => (
          <Bar key={j} item={item} span={span} />
        ))}
      </Box>
      <styled.span
        fontSize="1"
        fontWeight="500"
        textAlign="right"
        color={end.color}
        whiteSpace="nowrap"
      >
        {end.text}
      </styled.span>
    </Grid>
  )
}

/** Steps, provider calls and webhooks on one clock, with faults marked where they landed. */
function Waterfall({ timeline }: { readonly timeline: Timeline }) {
  const span = Math.max(timeline.spanMs, 1)

  return (
    <Panel p="4" overflowX="auto">
      <Box minW="44rem">
        <Grid gridTemplateColumns={LANE_COLUMNS} columnGap="4" alignItems="center">
          <Box />
          <Box position="relative" h="5" color="signal.faint" fontSize="1">
            {TICKS.map((tick) => (
              <styled.span
                key={tick}
                position="absolute"
                whiteSpace="nowrap"
                style={{
                  left: `${tick * 100}%`,
                  transform: `translateX(${TICK_SHIFT[tick] ?? "-50%"})`,
                }}
              >
                {duration(tick * span)}
              </styled.span>
            ))}
          </Box>
          <Box />
        </Grid>
        <styled.ol aria-label="Timeline">
          {lanesOf(timeline.items).map((lane, i) => (
            <LaneRow key={`${lane.kind}-${i}`} lane={lane} first={i === 0} span={span} />
          ))}
        </styled.ol>
      </Box>
    </Panel>
  )
}

function Exchange({ exchange }: { readonly exchange: RecordedExchange }) {
  const outcome = exchange.aborted ? "aborted" : String(exchange.status ?? "no answer")

  return (
    <styled.details
      borderBottomWidth="1px"
      borderColor="signal.rule"
      _last={{ borderBottomWidth: "0" }}
      data-exchange={exchange.id}
    >
      <styled.summary
        cursor="pointer"
        display="grid"
        gridTemplateColumns="4rem minmax(0, 1fr) auto"
        gap="3"
        alignItems="center"
        px="4"
        py="2.5"
        _hover={{ bg: "signal.raised" }}
      >
        <styled.span
          fontWeight="600"
          fontSize="1"
          fontFamily="mono"
          color={statusColor({ outcome, bad: exchange.aborted || (exchange.status ?? 500) >= 400 })}
        >
          {outcome}
        </styled.span>
        <Ident fontSize="1" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
          {exchange.method} {exchange.host}
          {exchange.path}
        </Ident>
        <HStack gap="2" justify="flex-end">
          {exchange.fault ? (
            <styled.span fontSize="1" color="verdict.failed.fg" fontWeight="500">
              fault: {exchange.fault}
            </styled.span>
          ) : null}
          {exchange.durationMs === undefined || exchange.durationMs === null ? null : (
            <styled.span color="signal.quiet" fontSize="1">
              {duration(exchange.durationMs)}
            </styled.span>
          )}
        </HStack>
      </styled.summary>
      <Grid gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="3" px="4" pb="4">
        <Stack gap="1">
          <Box fontSize="1" color="signal.quiet">
            Request
          </Box>
          <Pre>{JSON.stringify(exchange.request ?? {}, null, 2)}</Pre>
        </Stack>
        <Stack gap="1">
          <Box fontSize="1" color="signal.quiet">
            Response
          </Box>
          <Pre>{JSON.stringify(exchange.response ?? {}, null, 2)}</Pre>
        </Stack>
      </Grid>
    </styled.details>
  )
}

const FIRST_CALLS = 12

/** The calls, faulted and failed ones first, the rest folded away past the first few. */
function Calls({ exchanges }: { readonly exchanges: readonly RecordedExchange[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? exchanges : exchanges.slice(0, FIRST_CALLS)

  return (
    <Panel overflow="hidden">
      {shown.map((exchange) => (
        <Exchange key={exchange.id} exchange={exchange} />
      ))}
      {exchanges.length > FIRST_CALLS ? (
        <styled.button
          type="button"
          w="full"
          py="2.5"
          color="signal.accent"
          fontSize="1.5"
          cursor="pointer"
          borderTopWidth="1px"
          borderColor="signal.rule"
          _hover={{ bg: "signal.raised" }}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all ${exchanges.length} calls`}
        </styled.button>
      ) : null}
    </Panel>
  )
}

/** How the run is named in the title: its attempt, or the fault it ran under. */
function runName(view: RecordView): string {
  const { run } = view.record

  if (run.kind === "test") return `attempt ${run.attempt}`

  return run.fault ? run.fault.label : "clean run"
}

/** Copies the Markdown failure page, to paste into an issue or an agent's prompt. */
function CopyPage({ text }: { readonly text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <styled.button
      type="button"
      h="9"
      px="3.5"
      rounded="md"
      fontSize="1.5"
      fontWeight="500"
      bg="signal.ink"
      color="signal.panel"
      cursor="pointer"
      _hover={{ opacity: 0.9 }}
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 2_000)
        })
      }
    >
      <span aria-live="polite">{copied ? "Copied" : "Copy failure page"}</span>
    </styled.button>
  )
}

const LEVEL_COLOR: Readonly<Record<string, string>> = {
  error: "verdict.failed.fg",
  warn: "verdict.flaky.fg",
}

/** What went wrong in the run: the error, where the body stopped, a diverged replay, notes. */
function Problem({ record }: { readonly record: RecordView["record"] }) {
  if (!record.error && !record.stopped && !record.divergence) return null

  const stopped =
    record.stopped && !record.notes.some((note) => note.includes(record.stopped ?? ""))
      ? record.stopped
      : undefined

  return (
    <Panel
      p="5"
      borderLeftWidth="4px"
      borderLeftColor="verdict.failed.solid"
      aria-label="What went wrong"
    >
      <Stack gap="2">
        {record.error ? (
          <>
            <Ident color="verdict.failed.fg" fontWeight="500">
              {record.error.code}
            </Ident>
            <styled.p fontSize="3" fontWeight="500" overflowWrap="anywhere">
              {record.error.message}
            </styled.p>
          </>
        ) : null}
        {[stopped, divergenceLine(record), ...record.notes].map((line) =>
          line ? (
            <Box key={line} fontSize="1.5" color="signal.quiet">
              {line}
            </Box>
          ) : null,
        )}
      </Stack>
    </Panel>
  )
}

function divergenceLine(record: RecordView["record"]): string | undefined {
  const { divergence } = record

  return divergence
    ? `The replay diverged at agent step ${divergence.step + 1} (${divergence.instruction}): ${divergence.reason}`
    : undefined
}

function Deliveries({ deliveries }: { readonly deliveries: RecordView["record"]["deliveries"] }) {
  return (
    <Panel overflow="hidden">
      {deliveries.map((d, i) => {
        const outcome = d.status === null ? (d.error ?? "no answer") : String(d.status)

        return (
          <Grid
            key={`${d.topic}-${i}`}
            gridTemplateColumns="4rem minmax(0, 1fr) auto"
            gap="3"
            px="4"
            py="2.5"
            alignItems="center"
            borderBottomWidth="1px"
            borderColor="signal.rule"
            _last={{ borderBottomWidth: "0" }}
          >
            <styled.span
              fontWeight="600"
              fontSize="1"
              fontFamily="mono"
              color={statusColor({ outcome, bad: d.status === null || d.status >= 400 })}
            >
              {outcome}
            </styled.span>
            <Ident fontSize="1">
              {d.service ? `${d.service} ` : ""}
              {d.topic}
              {d.attempt > 1 ? `, attempt ${d.attempt}` : ""}
            </Ident>
            {d.fault ? (
              <styled.span fontSize="1" color="verdict.failed.fg" fontWeight="500">
                fault: {d.fault}
              </styled.span>
            ) : (
              <span />
            )}
          </Grid>
        )
      })}
    </Panel>
  )
}

/** The app's console errors and warnings, by the step they came in. */
function ConsoleLog({ logs }: { readonly logs: RecordView["record"]["appLog"] }) {
  return (
    <Pre>
      {logs.map((log, i) => (
        <styled.span key={i} display="block" color={LEVEL_COLOR[log.level]}>
          {`step ${log.step}  ${log.level.padEnd(5)}  ${log.text}`}
        </styled.span>
      ))}
    </Pre>
  )
}

/** A section's content, or a line saying there is none. */
function OrNone({
  none,
  children,
}: {
  readonly none: string | false
  readonly children: ReactNode
}) {
  return none === false ? children : <Box color="signal.quiet">{none}</Box>
}

function RecordHeader({ view }: { readonly view: RecordView }) {
  const { record } = view

  return (
    <PageTitle
      title={record.test}
      detail={
        <HStack gap="2" flexWrap="wrap">
          <StatusBadge status={record.status} />
          <Ident>{runName(view)}</Ident>
          <span>
            started{" "}
            <time
              dateTime={record.startedAt}
              title={when(record.startedAt)}
              suppressHydrationWarning
            >
              {ago(record.startedAt)}
            </time>
            , took {duration(record.durationMs)}
          </span>
        </HStack>
      }
      actions={view.page ? <CopyPage text={view.page} /> : <KeyHint />}
    />
  )
}

function RecordPage() {
  const view = Route.useLoaderData()

  if (view === null)
    return (
      <Empty
        title="No such record"
        hint={
          <>
            Records are pruned with their run; the latest 20 runs keep theirs.{" "}
            <Link to="/">See all runs</Link>
          </>
        }
      />
    )

  const { record } = view
  const logs = record.appLog.filter((log) => log.level === "error" || log.level === "warn")

  return (
    <>
      <RecordHeader view={view} />
      <Problem record={record} />
      <Section title="Steps" count={view.steps.length}>
        <Steps view={view} />
      </Section>
      <Section title="Timeline" aside={<TimelineLegend />}>
        <OrNone none={view.timeline.items.length === 0 && "Nothing was timed in this run."}>
          <Waterfall timeline={view.timeline} />
        </OrNone>
      </Section>
      <Section title="Provider calls" count={record.exchanges.length}>
        <OrNone none={record.exchanges.length === 0 && "No calls went through the proxy."}>
          <Calls exchanges={record.exchanges} />
        </OrNone>
      </Section>
      <Section title="Webhooks" count={record.deliveries.length}>
        <OrNone none={record.deliveries.length === 0 && "No webhook deliveries."}>
          <Deliveries deliveries={record.deliveries} />
        </OrNone>
      </Section>
      <Section title="Console" count={logs.length}>
        <OrNone none={logs.length === 0 && "No errors or warnings."}>
          <ConsoleLog logs={logs} />
        </OrNone>
      </Section>
      {view.screen ? (
        <Section title="Screen at failure">
          <Pre>{view.screen}</Pre>
        </Section>
      ) : null}
      <Section title="Emulator state">
        <styled.details>
          <styled.summary
            cursor="pointer"
            color="signal.accent"
            fontSize="1.5"
            mb="2"
            w="fit-content"
          >
            What the providers held when the run ended
          </styled.summary>
          <Pre>{view.state}</Pre>
        </styled.details>
      </Section>
      {view.page ? (
        <Section title="Failure page" aside={<CopyPage text={view.page} />}>
          <Panel px={{ base: "5", md: "8" }} py="6" maxW="56rem">
            <MarkdownDocument text={view.page} />
          </Panel>
        </Section>
      ) : null}
    </>
  )
}

function TimelineLegend() {
  const entries: readonly [string, string][] = [
    ["Step", "signal.ruleStrong"],
    ["Provider call", "signal.accent"],
    ["Failed", "verdict.failed.solid"],
  ]

  return (
    <HStack
      as="ul"
      aria-label="Timeline legend"
      gap="4"
      fontSize="1"
      color="signal.quiet"
      flexWrap="wrap"
    >
      {entries.map(([label, color]) => (
        <HStack as="li" key={label} gap="1.5">
          <Box w="3" h="2" rounded="sm" bg={color} />
          {label}
        </HStack>
      ))}
      <HStack as="li" gap="1.5">
        <Box
          w="3"
          h="2"
          rounded="sm"
          bg="signal.accentSoft"
          borderWidth="1.5px"
          borderColor="signal.accent"
        />
        Webhook
      </HStack>
      <HStack as="li" gap="1.5">
        <Box w="2" h="2" bg="verdict.failed.solid" transform="rotate(45deg)" />
        Fault
      </HStack>
    </HStack>
  )
}
