import { css } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

type SidebarMenuSubItemProps = React.ComponentProps<"li"> & JsxStyleProps

const subItemStyles = css({
  position: "relative",
})

export const SidebarMenuSubItem = (props: SidebarMenuSubItemProps) => {
  return <li className={subItemStyles} data-slot="sidebar-menu-sub-item" {...props} />
}
