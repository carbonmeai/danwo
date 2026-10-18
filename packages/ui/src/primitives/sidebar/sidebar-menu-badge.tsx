import { css, cx } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

type SidebarMenuBadgeProps = React.ComponentProps<"div"> & JsxStyleProps

const menuBadgeStyles = css({
  alignItems: "center",
  color: "text.muted",
  display: "inline-flex",
  fontSize: "0.75rem",
  fontVariantNumeric: "tabular-nums",
  fontWeight: "500",
  h: "5",
  justifyContent: "center",
  minW: "5",
  pointerEvents: "none",
  position: "absolute",
  px: "1",
  right: "1",
  rounded: "md",
  // centred on the row whatever the button height
  top: "50%",
  transform: "translateY(-50%)",
  textOverflow: "ellipsis",
  userSelect: "none",
  whiteSpace: "nowrap",
})

const collapsedBadgeStyles = css({
  // the icon rail has no room for a count; the button tooltip carries it
  "[data-collapsible=icon] &": {
    display: "none",
  },
})

export const SidebarMenuBadge = (props: SidebarMenuBadgeProps) => {
  return (
    <div
      className={cx(menuBadgeStyles, collapsedBadgeStyles)}
      data-slot="sidebar-menu-badge"
      {...props}
    />
  )
}
