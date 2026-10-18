import { css, cx } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Slot } from "radix-ui"
import type * as React from "react"

type SidebarGroupActionProps = React.ComponentProps<"button"> &
  JsxStyleProps & {
    asChild?: boolean
  }

const groupActionStyles = css({
  _focusVisible: {
    ring: "2px",
    ringColor: "border.focused",
  },
  _hover: {
    bg: "background.muted",
    color: "text.app",
  },
  "& > svg": {
    h: "4",
    w: "4",
  },
  alignItems: "center",
  color: "text.muted",
  cursor: "pointer",
  display: "flex",
  h: "5",
  justifyContent: "center",
  outline: "none",
  overflow: "hidden",
  position: "absolute",
  right: "3",
  ring: "none",
  rounded: "md",
  top: "3.5",
  transitionDuration: "200ms",
  transitionProperty: "opacity",
  transitionTimingFunction: "linear",
  w: "5",
})

const collapsedActionStyles = css({
  "[data-collapsible=icon] &": {
    opacity: "0",
    pointerEvents: "none",
  },
})

export const SidebarGroupAction = ({ asChild = false, ...props }: SidebarGroupActionProps) => {
  const Component = asChild ? Slot.Root : "button"

  return (
    <Component
      className={cx(groupActionStyles, collapsedActionStyles)}
      data-slot="sidebar-group-action"
      type={asChild ? undefined : "button"}
      {...props}
    />
  )
}
