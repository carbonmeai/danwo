import { Box, Grid, HStack, Stack, styled } from "@danwo/ui/jsx"
import { useRef } from "react"

import { Code, Ident } from "../../components/code.tsx"
import { ListFilter } from "../../components/controls.tsx"
import { Empty } from "../../components/empty-state.tsx"
import { Page } from "../../components/page.tsx"
import { Row, RowList, RowPanel } from "../../components/table.tsx"
import { useFilter, useListKeys } from "../../lib/list-keys.ts"
import type { ImpactRow } from "./impact-data.ts"

/** A provider, route or webhook as a small grey chip, in the mono face. */
const Chip = styled("span", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    h: "22px",
    px: "1.5",
    rounded: "6px",
    fontFamily: "mono",
    fontSize: "1",
    whiteSpace: "nowrap",
    bg: "surface.hover",
    color: "ink.soft",
  },
  variants: {
    kind: {
      provider: { color: "ink.strong", fontWeight: "500" },
      route: {},
      webhook: { bg: "verdict.notJudged.bg", color: "verdict.notJudged.fg" },
    },
  },
})

function Chips({
  items,
  kind,
}: {
  readonly items: readonly string[]
  readonly kind: "provider" | "route" | "webhook"
}) {
  if (items.length === 0) return <styled.span color="ink.faint">–</styled.span>

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

const Label = styled("div", { base: { color: "ink.muted", fontSize: "1", mb: "1" } })

function ImpactLine({ row, current }: { readonly row: ImpactRow; readonly current: boolean }) {
  return (
    <Row data-row data-current={current || undefined} py="3">
      <Grid
        gridTemplateColumns={{
          base: "1fr",
          lg: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
        }}
        gap="4"
      >
        <styled.span fontWeight="500" overflowWrap="anywhere" minW="0">
          {row.test}
        </styled.span>
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
          <styled.details fontSize="1" color="ink.muted" gridColumn="1 / -1">
            <styled.summary cursor="pointer" w="fit-content" _hover={{ color: "ink.strong" }}>
              {row.calls.length} provider {row.calls.length === 1 ? "call" : "calls"}
            </styled.summary>
            <Stack gap="0.5" mt="1">
              {row.calls.map((call) => (
                <Ident key={call}>{call}</Ident>
              ))}
            </Stack>
          </styled.details>
        ) : null}
      </Grid>
    </Row>
  )
}

/** What each test touches behind the app, as `danwo test --changed` reads it. */
export function ImpactPage({ rows }: { readonly rows: readonly ImpactRow[] }) {
  const filter = useFilter(rows, impactText)
  const { shown, deferred } = filter
  const list = useRef<HTMLUListElement>(null)
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
      <RowPanel pt="1.5">
        <RowList ref={list} aria-label="Tests">
          {shown.map((row, i) => (
            <ImpactLine key={row.test} row={row} current={i === current} />
          ))}
        </RowList>
        {shown.length === 0 ? (
          <styled.p p="6" color="ink.muted" textAlign="center">
            No test matches “{deferred}”.
          </styled.p>
        ) : null}
      </RowPanel>
    </Page>
  )
}
