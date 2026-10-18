import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

const StyledTitle = styled(AlertDialogPrimitive.Title)

export const AlertDialogTitle = ({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title> & JsxStyleProps) => {
  return <StyledTitle data-slot="alert-dialog-title" fontSize="3" fontWeight="500" {...props} />
}
