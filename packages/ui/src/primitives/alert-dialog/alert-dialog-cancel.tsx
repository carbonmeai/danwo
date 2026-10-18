import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
import type * as React from "react"

const StyledCancel = styled(AlertDialogPrimitive.Cancel)

export const AlertDialogCancel = (
  props: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> & JsxStyleProps,
) => {
  return <StyledCancel {...props} />
}
