import { Box, HStack, Stack, styled } from "@danwo/ui/jsx"
import type { ReactNode, RefObject } from "react"

/** The five verdict colours every status reads in. */
export type Tone = "passed" | "failed" | "flaky" | "notJudged" | "invalid"

/** Which colour each status reads in, so a failure looks the same on every page. */
const TONES: Readonly<Record<string, Tone>> = {
  passed: "passed",
  matched: "passed",
  replayed: "passed",
  holds: "passed",
  failed: "failed",
  fails: "failed",
  diverged: "failed",
  "timed-out": "failed",
  interrupted: "failed",
  "environment-error": "failed",
  flaky: "flaky",
  relocated: "flaky",
  "handed-off": "flaky",
  stale: "flaky",
  partial: "flaky",
  "not-judged": "notJudged",
  blocked: "notJudged",
  inconclusive: "notJudged",
  invalid: "invalid",
  missed: "invalid",
  skipped: "invalid",
}

export function toneOf(status: string): Tone {
  return TONES[status] ?? "invalid"
}

/** How each status is written: words, not codes. */
const WORDS: Readonly<Record<string, string>> = {
  "not-judged": "not judged",
  "timed-out": "timed out",
  "environment-error": "environment error",
  "handed-off": "handed off",
}

export function wordOf(status: string): string {
  return WORDS[status] ?? status
}

const Chip = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "1.5",
    px: "2",
    h: "5",
    rounded: "full",
    fontSize: "1",
    fontWeight: "500",
    whiteSpace: "nowrap",
    lineHeight: "1",
    _before: { content: '""', w: "1.5", h: "1.5", rounded: "full", bg: "currentColor" },
  },
  variants: {
    tone: {
      passed: { bg: "verdict.passed.bg", color: "verdict.passed.fg" },
      failed: { bg: "verdict.failed.bg", color: "verdict.failed.fg" },
      flaky: { bg: "verdict.flaky.bg", color: "verdict.flaky.fg" },
      notJudged: { bg: "verdict.notJudged.bg", color: "verdict.notJudged.fg" },
      invalid: { bg: "verdict.invalid.bg", color: "verdict.invalid.fg" },
    },
  },
})

/** A status as a small coloured label; unknown statuses read neutral. */
export function StatusBadge({ status }: { readonly status: string }) {
  return (
    <Chip tone={toneOf(status)} data-status={status}>
      {wordOf(status)}
    </Chip>
  )
}

/** A filled swatch in a verdict's colour, for grids and legends. */
export const Swatch = styled("span", {
  base: { display: "inline-block", rounded: "sm", flexShrink: "0" },
  variants: {
    tone: {
      passed: { bg: "verdict.passed.solid" },
      failed: { bg: "verdict.failed.solid" },
      flaky: { bg: "verdict.flaky.solid" },
      notJudged: { bg: "verdict.notJudged.solid" },
      invalid: { bg: "verdict.invalid.solid" },
    },
  },
})

/** One count in a run's verdict strip. */
export interface Share {
  readonly tone: Tone
  readonly count: number
  readonly label: string
}

/** A run's verdicts as one proportional bar: how much passed, failed and so on, at a glance. */
export function VerdictStrip({
  shares,
  width = "8rem",
}: {
  readonly shares: readonly Share[]
  readonly width?: string
}) {
  const total = shares.reduce((sum, share) => sum + share.count, 0)

  if (total === 0) return <Box w={width} h="1.5" rounded="full" bg="signal.rule" />

  return (
    <HStack
      gap="0.5"
      w={width}
      h="1.5"
      aria-hidden="true"
      title={shares
        .filter((s) => s.count > 0)
        .map((s) => `${s.count} ${s.label}`)
        .join(", ")}
    >
      {shares
        .filter((share) => share.count > 0)
        .map((share) => (
          <Swatch
            key={share.label}
            tone={share.tone}
            h="full"
            style={{ flexGrow: share.count, flexBasis: 0 }}
          />
        ))}
    </HStack>
  )
}

/** A page's heading, what it is about, and any actions on its right. */
export function PageTitle({
  title,
  detail,
  actions,
}: {
  readonly title: string
  readonly detail?: ReactNode
  readonly actions?: ReactNode
}) {
  return (
    <HStack justify="space-between" alignItems="end" gap="6" mb="6" flexWrap="wrap">
      <Stack gap="1.5" minW="0">
        <styled.h1
          fontSize="6"
          fontWeight="600"
          letterSpacing="-0.015em"
          lineHeight="1.2"
          overflowWrap="anywhere"
        >
          {title}
        </styled.h1>
        {detail === undefined ? null : (
          <Box color="signal.quiet" fontSize="2">
            {detail}
          </Box>
        )}
      </Stack>
      {actions}
    </HStack>
  )
}

/** Facts about a run or record, label above value, laid out in a row. */
export function Facts({ items }: { readonly items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <styled.dl display="flex" flexWrap="wrap" columnGap="8" rowGap="3" mb="6">
      {items.map(([label, value]) => (
        <Stack key={label} gap="0.5">
          <styled.dt color="signal.quiet" fontSize="1">
            {label}
          </styled.dt>
          <styled.dd fontSize="3" fontWeight="500">
            {value}
          </styled.dd>
        </Stack>
      ))}
    </styled.dl>
  )
}

/** A white panel on the ground, for a group of related content. */
export const Panel = styled("div", {
  base: {
    bg: "signal.panel",
    borderWidth: "1px",
    borderColor: "signal.rule",
    rounded: "lg",
  },
})

/** A titled section of a page; its title names the region for screen readers. */
export function Section({
  title,
  count,
  aside,
  children,
}: {
  readonly title: string
  readonly count?: number
  readonly aside?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <Stack as="section" gap="3" mt="10" aria-label={title}>
      <HStack justify="space-between" gap="4">
        <styled.h2 fontSize="4" fontWeight="600" letterSpacing="-0.01em">
          {title}
          {count === undefined ? null : (
            <styled.span color="signal.quiet" fontWeight="400" ml="2">
              {count}
            </styled.span>
          )}
        </styled.h2>
        {aside}
      </HStack>
      {children}
    </Stack>
  )
}

/** What a page shows when there is nothing to show yet, and the command that fills it. */
export function Empty({
  title,
  hint,
  command,
}: {
  readonly title: string
  readonly hint: ReactNode
  readonly command?: string
}) {
  return (
    <Stack alignItems="center" gap="3" py="20" textAlign="center" data-empty>
      <Box color="signal.faint">
        <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="8" width="13" height="13" rx="3" fill="currentColor" opacity="0.35" />
          <rect
            x="3"
            y="3"
            width="13"
            height="13"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="3 2"
          />
        </svg>
      </Box>
      <styled.p fontWeight="600" fontSize="4">
        {title}
      </styled.p>
      <Box color="signal.quiet" fontSize="2" maxW="34rem">
        {hint}
      </Box>
      {command === undefined ? null : <Command text={command} />}
    </Stack>
  )
}

/** A short monospace span, for commands, codes and routes. */
export const Code = styled("code", {
  base: {
    fontFamily: "mono",
    fontSize: "0.92em",
    bg: "signal.raised",
    borderWidth: "1px",
    borderColor: "signal.rule",
    px: "1",
    rounded: "sm",
    overflowWrap: "anywhere",
  },
})

/** A command to run, set apart so it reads as something to copy into a terminal. */
export function Command({ text }: { readonly text: string }) {
  return (
    <styled.code
      display="inline-block"
      fontFamily="mono"
      fontSize="2"
      px="3"
      py="1.5"
      rounded="md"
      bg="signal.panel"
      borderWidth="1px"
      borderColor="signal.ruleStrong"
      color="signal.ink"
    >
      <styled.span color="signal.faint" userSelect="none">
        ${" "}
      </styled.span>
      {text}
    </styled.code>
  )
}

/** A machine name such as a route or fault label, in the mono face. */
export const Ident = styled("span", {
  base: { fontFamily: "mono", fontSize: "0.92em", overflowWrap: "anywhere" },
})

/** The filter box a list jumps to on `/`. */
const FilterInput = styled("input", {
  base: {
    h: "9",
    px: "3",
    w: { base: "full", sm: "18rem" },
    rounded: "md",
    bg: "signal.panel",
    borderWidth: "1px",
    borderColor: "signal.ruleStrong",
    color: "signal.ink",
    fontSize: "1.5",
    _placeholder: { color: "signal.faint" },
    _focusVisible: { outline: "2px solid {colors.signal.focus}", outlineOffset: "0" },
  },
})

/** A key, as the keyboard hints show it. */
const Kbd = styled("kbd", {
  base: {
    fontFamily: "mono",
    fontSize: "1",
    px: "1.5",
    rounded: "sm",
    borderWidth: "1px",
    borderBottomWidth: "2px",
    borderColor: "signal.ruleStrong",
    color: "signal.quiet",
    bg: "signal.panel",
  },
})

/** The keys a list answers to. */
export function KeyHint({ filter = false }: { readonly filter?: boolean }) {
  return (
    <HStack gap="1.5" color="signal.quiet" fontSize="1" display={{ base: "none", lg: "flex" }}>
      <Kbd>j</Kbd>
      <Kbd>k</Kbd>
      <span>{filter ? "to move," : "to move"}</span>
      {filter ? (
        <>
          <Kbd>/</Kbd>
          <span>to filter</span>
        </>
      ) : null}
    </HStack>
  )
}

/** A lint rule with a dot in its severity's colour. */
export function LintLabel({
  rule,
  severity,
}: {
  readonly rule: string
  readonly severity: string
}) {
  return (
    <HStack gap="2" minW="0">
      <Swatch tone={severity === "error" ? "failed" : "flaky"} w="2" h="2" rounded="full" />
      <Ident>{rule}</Ident>
    </HStack>
  )
}

/** A list's key hints and its filter box. */
export function ListFilter({
  label,
  placeholder,
  filter,
}: {
  readonly label: string
  readonly placeholder: string
  readonly filter: {
    readonly query: string
    readonly setQuery: (query: string) => void
    readonly box: RefObject<HTMLInputElement | null>
  }
}) {
  return (
    <HStack gap="3">
      <KeyHint filter />
      <FilterInput
        ref={filter.box}
        type="search"
        placeholder={placeholder}
        aria-label={label}
        value={filter.query}
        onChange={(event) => filter.setQuery(event.target.value)}
      />
    </HStack>
  )
}
