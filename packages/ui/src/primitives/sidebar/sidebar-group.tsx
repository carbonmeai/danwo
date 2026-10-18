import { css, cx } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

type SidebarGroupProps = React.ComponentProps<"div"> & JsxStyleProps

const groupStyles = css({
  display: "flex",
  flexDirection: "column",
  minW: "0",
  p: "2",
  position: "relative",
  w: "full",
})

export const SidebarGroup = ({ className, ...props }: SidebarGroupProps) => {
  return <div className={cx(groupStyles, className)} data-slot="sidebar-group" {...props} />
}
