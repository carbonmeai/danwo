import { Icons } from "@danwo/ui/icons/base"

import { KeyHint } from "../../components/controls.tsx"
import { Page } from "../../components/page.tsx"
import { Section, StatCards } from "../../components/panel.tsx"
import { Bone, StatCardSkeleton } from "../../components/skeleton.tsx"
import { FlakyTestSkeleton } from "./flaky-tests.tsx"
import { type TableOrder, TestTableSkeleton } from "./test-table.tsx"

/**
 * The insights while they load: the same cards, the flaky tests and the table of every test, as
 * bones. The charts further down load with the rest.
 */
export function InsightsSkeleton({ sorting }: { readonly sorting: TableOrder }) {
  return (
    <Page
      crumbs={["Insights"]}
      title="Insights"
      detail={
        <>
          Across the latest <Bone inline w="1.5rem" /> test runs
        </>
      }
      actions={<KeyHint />}
      loading="Loading the insights"
    >
      <StatCards>
        <StatCardSkeleton label="Flaky tests" icon={<Icons.refresh size={13} />} />
        <StatCardSkeleton label="Slowest test" icon={<Icons.clock size={13} />} />
        <StatCardSkeleton label="Spend on tests" icon={<Icons.dollar size={13} />} />
        <StatCardSkeleton label="Lint findings" icon={<Icons.shieldCheck size={13} />} />
      </StatCards>
      <Section title="Flaky tests">
        <FlakyTestSkeleton />
      </Section>
      <Section title="Every test" bare>
        <TestTableSkeleton sorting={sorting} />
      </Section>
    </Page>
  )
}
