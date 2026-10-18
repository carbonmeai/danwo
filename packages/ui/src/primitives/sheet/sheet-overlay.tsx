import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import { Dialog as SheetPrimitive } from "radix-ui"
import type * as React from "react"

const overlayStyles = cva({
  base: {
    bg: "background.popoverOverlay",
    glass: "overlay",
    inset: "0",
    pos: "fixed",
    zIndex: "100",
  },
})

const StyledOverlay = styled(SheetPrimitive.Overlay, overlayStyles)

export const SheetOverlay = (props: React.ComponentProps<typeof SheetPrimitive.Overlay>) => {
  return <StyledOverlay {...props} />
}
