import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import { Dialog as DialogPrimitive } from "radix-ui"
import type * as React from "react"

type Props = React.ComponentProps<typeof DialogPrimitive.Overlay>

const overlayStyles = cva({
  base: {
    bg: "background.popoverOverlay",
    glass: "overlay",
    inset: "0",
    pos: "fixed",
    zIndex: "100",
  },
})

const StyledOverlay = styled(DialogPrimitive.Overlay, overlayStyles)

export const DialogOverlay = function DialogOverlay({ ...props }: Props) {
  return <StyledOverlay data-slot="dialog-overlay" {...props} />
}
