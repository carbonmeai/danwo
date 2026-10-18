import { css, cx } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

import { useSidebar } from "./sidebar-provider"

type SidebarRailProps = React.ComponentProps<"button"> &
  JsxStyleProps & {
    side?: "left" | "right"
  }

const railStyles = css({
  _hover: {
    "&::after": {
      bg: "color.gray.4",
    },
  },
  "&::after": {
    content: '""',
    insetY: "0",
    position: "absolute",
    transition: "background-color 200ms",
    w: "0.5",
  },
  alignItems: "flex-start",
  bg: "transparent",
  border: "none",
  cursor: "col-resize",
  display: "none",
  insetY: "0",
  justifyContent: "center",
  outline: "none",
  position: "absolute",
  pt: "2",
  sm: {
    display: "flex",
  },
  transition: "all",
  transitionDuration: "200ms",
  w: "4",
  zIndex: 20,
})

const railLeftStyles = css({
  "&::after": {
    left: "50%",
    transform: "translateX(-50%)",
  },
  right: "-4",
})

const railRightStyles = css({
  "&::after": {
    right: "50%",
    transform: "translateX(50%)",
  },
  left: "-4",
})

export const SidebarRail = ({ side = "left", onClick, ...props }: SidebarRailProps) => {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      aria-label="Toggle Sidebar"
      className={cx(railStyles, side === "right" ? railRightStyles : railLeftStyles)}
      data-side={side}
      data-slot="sidebar-rail"
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      tabIndex={-1}
      title="Toggle Sidebar"
      type="button"
      {...props}
    />
  )
}
