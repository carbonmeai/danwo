import { css } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

type SidebarHeaderProps = React.ComponentProps<"div"> & JsxStyleProps

/**
 * 2.75rem literally, the same as FilterHeader and the results TopBar, so all
 * three page-chrome rules meet. Height is declared rather than derived from
 * padding plus whatever the trigger happens to be, which only lined up by luck.
 */
const headerStyles = css({
  borderBottomWidth: "1px",
  borderColor: "brand.panel.4",
  display: "flex",
  flexDirection: "column",
  flexShrink: "0",
  gap: "2",
  h: "2.75rem",
  justifyContent: "center",
  px: "2",
  py: "0",
})

export const SidebarHeader = (props: SidebarHeaderProps) => {
  return <div className={headerStyles} data-slot="sidebar-header" {...props} />
}
