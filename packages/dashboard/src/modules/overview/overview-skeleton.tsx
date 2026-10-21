import { Icons } from "@danwo/ui/icons/base"
import { Grid } from "@danwo/ui/jsx"
import { Span } from "@danwo/ui/primitives/typography"

import { ChoiceSkeleton } from "../../components/choice.tsx"
import { Page } from "../../components/page.tsx"
import { ListRows, Section, StatCards } from "../../components/panel.tsx"
import { BlockBone, ListRowSkeleton, Repeat, StatCardSkeleton } from "../../components/skeleton.tsx"
import { overviewDetail } from "./overview-page.tsx"

/** A trend's section with its chart still loading. */
function TrendSkeleton({ title }: { readonly title: string }) {
  return (
    <Section title={title}>
      <BlockBone h="8rem" />
    </Section>
  )
}

/** A list's section with its rows still loading. */
function ListSkeleton({ title }: { readonly title: string }) {
  return (
    <Section title={title}>
      <ListRows>
        <Repeat count={3}>{(i) => <ListRowSkeleton key={i} i={i} lines={2} />}</Repeat>
      </ListRows>
    </Section>
  )
}

/** The overview while its figures load: the same cards, chart, trends and lists, as bones. */
export function OverviewSkeleton({ range }: { readonly range: number }) {
  return (
    <Page
      crumbs={["Overview"]}
      title="Overview"
      detail={overviewDetail(range)}
      actions={<ChoiceSkeleton />}
      loading="Loading the overview"
    >
      <StatCards columns={4}>
        <StatCardSkeleton label="Pass rate" icon={<Icons.checkCircle size={14} />} />
        <StatCardSkeleton label="Runs" icon={<Icons.play size={14} />} />
        <StatCardSkeleton label="Failed tests" icon={<Icons.warn size={14} />} />
        <StatCardSkeleton label="Average run time" icon={<Icons.clock size={14} />} />
      </StatCards>
      <Section
        title="Runs per day"
        aside={
          <Span color="ink.muted" fontSize="1">
            A day opens its runs
          </Span>
        }
      >
        <BlockBone h="11rem" />
      </Section>
      <Grid gridTemplateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="2" mt="2">
        <TrendSkeleton title="Pass rate trend" />
        <TrendSkeleton title="Run duration" />
      </Grid>
      <Grid gridTemplateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="2" mt="2">
        <ListSkeleton title="Worth a look" />
        <ListSkeleton title="Breaks under faults" />
      </Grid>
    </Page>
  )
}
