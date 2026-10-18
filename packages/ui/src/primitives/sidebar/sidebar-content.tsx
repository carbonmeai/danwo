import { css, cx } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

type SidebarContentProps = React.ComponentProps<"div"> & JsxStyleProps

const contentStyles = css({
  "&::-webkit-scrollbar": {
    display: "none",
  },
  display: "flex",
  flex: "1",
  flexDirection: "column",
  gap: "2",
  minH: "0",
  overflow: "auto",
  scrollbarWidth: "none",
})

const collapsedContentStyles = css({
  "[data-collapsible=icon] &": {
    overflow: "hidden",
  },
})

export const SidebarContent = (props: SidebarContentProps) => {
  return (
    <div
      className={cx(contentStyles, collapsedContentStyles)}
      data-slot="sidebar-content"
      {...props}
    />
  )
}
