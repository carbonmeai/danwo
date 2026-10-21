import { ChoiceSkeleton } from "../../components/choice.tsx"
import { ListFilterSkeleton } from "../../components/controls.tsx"
import { Page } from "../../components/page.tsx"
import { PanelTable } from "../../components/panel.tsx"
import { Bone, Repeat } from "../../components/skeleton.tsx"
import type { RunKind } from "./runs-data.ts"
import { FilterRow, KIND_HELP } from "./runs-page.tsx"
import { RunLineSkeleton, RunsHead } from "./runs-table.tsx"

/** Rows enough to fill a tall window; the page scrolls past the rest once they load. */
const ROWS = 12

/** The runs list while it loads: its filters, its count and its table, as bones. */
export function RunsSkeleton({ kind }: { readonly kind?: RunKind | undefined }) {
  return (
    <Page
      crumbs={["Runs"]}
      title="Runs"
      detail={KIND_HELP[kind ?? "both"]}
      actions={<ListFilterSkeleton />}
      loading="Loading the runs"
    >
      <FilterRow
        filters={<Repeat count={4}>{(i) => <ChoiceSkeleton key={i} />}</Repeat>}
        count={<Bone w="5rem" />}
      />
      <PanelTable label="Runs" head={<RunsHead />}>
        <Repeat count={ROWS}>{(i) => <RunLineSkeleton key={i} i={i} />}</Repeat>
      </PanelTable>
    </Page>
  )
}
