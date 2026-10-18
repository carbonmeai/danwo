import { css } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

type SidebarGroupContentProps = React.ComponentProps<"div"> & JsxStyleProps

const groupContentStyles = css({
  fontSize: "sm",
  w: "full",
})

export const SidebarGroupContent = (props: SidebarGroupContentProps) => {
  return <div className={groupContentStyles} data-slot="sidebar-group-content" {...props} />
}
