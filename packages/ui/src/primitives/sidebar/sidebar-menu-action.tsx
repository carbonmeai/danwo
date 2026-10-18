import { css, cx } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Slot } from "radix-ui"
import type * as React from "react"

type SidebarMenuActionProps = React.ComponentProps<"button"> &
  JsxStyleProps & {
    asChild?: boolean
    showOnHover?: boolean
  }

const menuActionStyles = css({
  _focusVisible: {
    opacity: "1",
    pointerEvents: "auto",
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
  right: "1",
  ring: "none",
  rounded: "md",
  top: "1.5",
  w: "5",
})

const collapsedMenuActionStyles = css({
  "[data-collapsible=icon] &": {
    display: "none",
  },
})

const hiddenByDefaultStyles = css({
  opacity: "0",
  pointerEvents: "none",
})

export const SidebarMenuAction = ({
  asChild = false,
  showOnHover = false,
  ...props
}: SidebarMenuActionProps) => {
  const Component = asChild ? Slot.Root : "button"

  return (
    <Component
      className={cx(
        menuActionStyles,
        showOnHover ? hiddenByDefaultStyles : undefined,
        collapsedMenuActionStyles,
      )}
      data-show-on-hover={showOnHover || undefined}
      data-slot="sidebar-menu-action"
      type={asChild ? undefined : "button"}
      {...props}
    />
  )
}
