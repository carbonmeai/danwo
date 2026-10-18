import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

import { Icons } from "../../icons/base"
import { Button } from "../button/button"
import { useSidebar } from "./sidebar-provider"

type SidebarTriggerProps = React.ComponentProps<typeof Button> & JsxStyleProps

export const SidebarTrigger = ({ onClick, ...props }: SidebarTriggerProps) => {
  const { toggleSidebar, state } = useSidebar()

  return (
    <Button
      data-slot="sidebar-trigger"
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      size="icon"
      variant="ghost"
      {...props}
    >
      {state === "expanded" ? <Icons.panelRightOpen /> : <Icons.panelRightClose />}
      <span
        style={{
          borderWidth: 0,
          clip: "rect(0, 0, 0, 0)",
          height: "1px",
          margin: "-1px",
          overflow: "hidden",
          padding: 0,
          position: "absolute",
          whiteSpace: "nowrap",
          width: "1px",
        }}
      >
        Toggle Sidebar
      </span>
    </Button>
  )
}
