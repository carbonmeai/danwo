import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
import type * as React from "react"

const StyledDescription = styled(AlertDialogPrimitive.Description)

export const AlertDialogDescription = (
  props: React.ComponentProps<typeof AlertDialogPrimitive.Description> & JsxStyleProps,
) => {
  return (
    <StyledDescription
      color="text.muted"
      data-slot="alert-dialog-description"
      fontWeight="500"
      {...props}
    />
  )
}
