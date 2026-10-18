import { css } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

type SidebarInsetProps = React.ComponentProps<"main"> & JsxStyleProps

const insetStyles = css({
  bg: "background.app",
  display: "flex",
  flex: "1",
  flexDirection: "column",
  minH: "svh",
  /*
   * flex children default to min-width:auto — without this, any wide content
   * (e.g. the tabular grid) stretches the whole page past the viewport.
   */
  minW: "0",
  overflowX: "hidden",
  position: "relative",
  w: "full",
})

export const SidebarInset = (props: SidebarInsetProps) => {
  return <main className={insetStyles} data-slot="sidebar-inset" {...props} />
}
