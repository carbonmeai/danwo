import { css, cx } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Slot } from "radix-ui"
import type * as React from "react"

type SidebarGroupLabelProps = React.ComponentProps<"div"> &
  JsxStyleProps & {
    asChild?: boolean
  }

const groupLabelStyles = css({
  "& > svg": {
    flexShrink: 0,
    h: "4",
    w: "4",
  },
  alignItems: "center",
  color: "text.muted",
  display: "flex",
  flexShrink: 0,
  fontSize: "0.75rem",
  fontWeight: "500",
  h: "8",
  letterSpacing: "0.025em",
  outline: "none",
  overflow: "hidden",
  px: "2",
  ring: "none",
  rounded: "md",
  textOverflow: "ellipsis",
  transitionDuration: "200ms",
  transitionProperty: "margin, opacity, width",
  transitionTimingFunction: "linear",
  whiteSpace: "nowrap",
})

const collapsedLabelStyles = css({
  "[data-collapsible=icon] &": {
    h: "0",
    m: "0",
    opacity: "0",
    overflow: "hidden",
    w: "0",
  },
})

export const SidebarGroupLabel = ({ asChild = false, ...props }: SidebarGroupLabelProps) => {
  const Component = asChild ? Slot.Root : "div"

  return (
    <Component
      className={cx(groupLabelStyles, collapsedLabelStyles)}
      data-slot="sidebar-group-label"
      {...props}
    />
  )
}
