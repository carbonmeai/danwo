import { HStack, Stack } from "@danwo/ui/jsx"
import { Span } from "@danwo/ui/primitives/typography"

import { ChoiceSkeleton } from "../../components/choice.tsx"
import { ListFilterSkeleton } from "../../components/controls.tsx"
import { Page } from "../../components/page.tsx"
import { PanelTable } from "../../components/panel-table.tsx"
import { Bone, ControlBone, lineWidth, Repeat } from "../../components/skeleton.tsx"
import { TESTS_DETAIL, TestRowSkeleton, testColumns, TestsLayout } from "./tests-page.tsx"

/** Rows enough to fill a tall window; the page scrolls past the rest once they load. */
const ROWS = 10

/** The files down the side, still loading: every test, then a few files. */
function GroupsSkeleton() {
  return (
    <Stack gap="0.5">
      <ControlBone w="full" />
      <Span color="ink.muted" fontSize="1" fontWeight="500" px="2.5" pt="3" pb="1">
        Files
      </Span>
      <Repeat count={4}>
        {(i) => (
          <HStack key={i} h="8" px="2.5">
            <Bone w={lineWidth(i + 1)} />
          </HStack>
        )}
      </Repeat>
    </Stack>
  )
}

/** The test library while it loads: its filters, its files and its table, as bones. */
export function TestsSkeleton() {
  return (
    <Page
      crumbs={["Tests"]}
      title="Tests"
      detail={TESTS_DETAIL}
      actions={
        <>
          <ChoiceSkeleton />
          <ListFilterSkeleton />
          <ControlBone w="5.5rem" />
        </>
      }
      loading="Loading the tests"
    >
      <TestsLayout side={<GroupsSkeleton />}>
        <PanelTable label="Tests" layout={testColumns(false)}>
          <Repeat count={ROWS}>{(i) => <TestRowSkeleton key={i} i={i} />}</Repeat>
        </PanelTable>
      </TestsLayout>
    </Page>
  )
}
