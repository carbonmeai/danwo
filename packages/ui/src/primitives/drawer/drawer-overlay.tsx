import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

const overlayStyles = cva({
  base: {
    "&[data-state=closed]": {
      animation: "fadeElementOut",
    },
    "&[data-state=open]": {
      animation: "fadeElementIn",
    },
    bg: "background.popoverOverlay",
    inset: "0",
    pos: "fixed",
    zIndex: "100",
  },
})

const StyledOverlay = styled(DrawerPrimitive.Overlay, overlayStyles)

export const DrawerOverlay = (props: React.ComponentProps<typeof DrawerPrimitive.Overlay>) => {
  return <StyledOverlay data-slot="drawer-overlay" {...props} />
}
