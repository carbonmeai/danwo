import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Dialog as DialogPrimitive } from "radix-ui"
import type * as React from "react"

type Props = React.ComponentProps<typeof DialogPrimitive.Title> & JsxStyleProps

const descriptionStyles = cva({
  base: {
    fontSize: "2",
  },
})

const StyledDialogDescription = styled(DialogPrimitive.Description, descriptionStyles)

export const DialogDescription = function DialogDescription({ ...props }: Props) {
  return <StyledDialogDescription data-slot="dialog-description" {...props} />
}
