import { styled } from "@danwo/ui/jsx"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
import type * as React from "react"

const StyledOverlay = styled(AlertDialogPrimitive.Overlay)

export const AlertDialogOverlay = ({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) => {
  return (
    <StyledOverlay
      backdropFilter="blur(2px)"
      data-slot="alert-dialog-overlay"
      inset="0"
      position="fixed"
      zIndex="100"
      {...props}
    />
  )
}
