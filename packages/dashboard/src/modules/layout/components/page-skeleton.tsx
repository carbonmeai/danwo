import { Page } from "../../../components/page.tsx"
import { Bone, ListPanelSkeleton } from "../../../components/skeleton.tsx"

/**
 * What a page with no skeleton of its own shows while its data loads: the page's frame, with its
 * place, title and a list of rows still loading. Each page with data of its own has a skeleton
 * shaped like it; this is the fallback.
 */
export function PageSkeleton() {
  return (
    <Page
      crumbs={[<Bone key="crumb" w="6rem" />]}
      title={<Bone w="10rem" />}
      detail={<Bone w="22rem" />}
      loading="Loading the page"
    >
      <ListPanelSkeleton count={8} />
    </Page>
  )
}
