import { Icons } from "@danwo/ui/icons/base"
import { Box, Grid, HStack, Stack } from "@danwo/ui/jsx"
import { Badge } from "@danwo/ui/primitives/badge"
import { Button } from "@danwo/ui/primitives/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@danwo/ui/primitives/collapsible"
import { Span, Text } from "@danwo/ui/primitives/typography"
import { useRef } from "react"

import { Code, Ident } from "../../components/code.tsx"
import { ListFilter } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { ListRow, ListRows, Panel } from "../../components/panel.tsx"
import { useFilter, useListKeys } from "../../lib/list-keys.ts"
import type { ImpactRow } from "./impact-data.ts"

/** A provider, route or webhook as the library's badge, in the mono face. */
function Chip({
  kind,
  children,
}: {
  readonly kind: "provider" | "route" | "webhook"
  readonly children: string
}) {
  return kind === "webhook" ? (
    <Badge look="soft" size="md" colorPalette="palette.blue" fontFamily="mono">
      {children}
    </Badge>
  ) : (
    <Badge
      look="soft"
      size="md"
      colorPalette="palette.gray"
      fontFamily="mono"
      fontWeight={kind === "provider" ? "500" : "400"}
    >
      {children}
    </Badge>
  )
}

function Chips({
  items,
  kind,
}: {
  readonly items: readonly string[]
  readonly kind: "provider" | "route" | "webhook"
}) {
  if (items.length === 0) return <Span color="ink.faint">–</Span>

  return (
    <HStack gap="1" flexWrap="wrap">
      {items.map((item) => (
        <Chip key={item} kind={kind}>
          {item}
        </Chip>
      ))}
    </HStack>
  )
}

/** What the filter searches in a row: the test and everything it touched. */
function impactText(row: ImpactRow): string {
  return [row.test, ...row.providers, ...row.routes, ...row.webhooks, ...row.calls].join(" ")
}

function Label({ children }: { readonly children: string }) {
  return (
    <Text color="ink.muted" fontSize="1" mb="1">
      {children}
    </Text>
  )
}

/** The provider calls a test made, folded away until asked for. */
function Calls({ calls }: { readonly calls: readonly string[] }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="xs" color="ink.muted" ml="-1.5">
          <Icons.caretRight size={12} />
          {calls.length} provider {calls.length === 1 ? "call" : "calls"}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Stack gap="0.5" mt="1" fontSize="1" color="ink.muted">
          {calls.map((call) => (
            <Ident key={call}>{call}</Ident>
          ))}
        </Stack>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ImpactLine({ row, current }: { readonly row: ImpactRow; readonly current: boolean }) {
  return (
    <ListRow
      data-row
      py="3"
      bg={current ? "surface.itemHover" : "surface.item"}
      boxShadow={current ? "inset 2px 0 0 {colors.ink.strong}" : undefined}
    >
      <Grid
        gridTemplateColumns={{
          base: "1fr",
          lg: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
        }}
        gap="4"
      >
        <Span fontWeight="500" overflowWrap="anywhere" minW="0">
          {row.test}
        </Span>
        <Box>
          <Label>Providers</Label>
          <Chips items={row.providers} kind="provider" />
        </Box>
        <Box>
          <Label>App routes</Label>
          <Chips items={row.routes} kind="route" />
        </Box>
        <Box>
          <Label>Webhooks</Label>
          <Chips items={row.webhooks} kind="webhook" />
        </Box>
        {row.calls.length > 0 ? (
          <Box gridColumn="1 / -1">
            <Calls calls={row.calls} />
          </Box>
        ) : null}
      </Grid>
    </ListRow>
  )
}

/** What each test touches behind the app, as `danwo test --changed` reads it. */
export function ImpactPage({ rows }: { readonly rows: readonly ImpactRow[] }) {
  const filter = useFilter(rows, impactText)
  const { shown, deferred } = filter
  const list = useRef<HTMLDivElement>(null)
  const current = useListKeys(list, shown.length, filter.box)

  if (rows.length === 0)
    return (
      <Page crumbs={["Impact"]} title="Impact">
        <Empty
          title="No impact index yet"
          hint={
            <>
              Every passing test adds what it touched behind the app to{" "}
              <Code>.danwo/impact.json</Code>: the providers, routes and webhooks. Then{" "}
              <Code>danwo test --changed</Code> runs only the tests a change can reach.
            </>
          }
          command="danwo test"
        />
      </Page>
    )

  return (
    <Page
      crumbs={["Impact"]}
      title="Impact"
      detail={
        <>
          What each test touches behind the app. <Code>danwo test --changed</Code> picks tests from
          it.
        </>
      }
      actions={
        <ListFilter
          label="Filter tests"
          placeholder="Filter by test, provider or route"
          filter={filter}
        />
      }
    >
      <Panel px="1.5" py="1.5">
        <ListRows ref={list} aria-label="Tests">
          {shown.map((row, i) => (
            <ImpactLine key={row.test} row={row} current={i === current} />
          ))}
        </ListRows>
        {shown.length === 0 ? (
          <Text p="6" color="ink.muted" textAlign="center">
            No test matches “{deferred}”.
          </Text>
        ) : null}
      </Panel>
    </Page>
  )
}
