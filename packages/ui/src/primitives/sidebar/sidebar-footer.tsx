import { css } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

type SidebarFooterProps = React.ComponentProps<"div"> & JsxStyleProps

const footerStyles = css({
  "[data-collapsible=icon] &": {
    h: "auto",
    py: "2",
  },
  borderColor: "brand.panel.4",
  // the footer is pushed to the bottom, so its rule sits above it
  borderTopWidth: "1px",
  display: "flex",
  flexDirection: "column",
  flexShrink: "0",
  gap: "2",
  h: "2.75rem",
  justifyContent: "center",
  px: "2",
  py: "0",
})

export const SidebarFooter = (props: SidebarFooterProps) => {
  return <div className={footerStyles} data-slot="sidebar-footer" {...props} />
}
