import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Dialog as DialogPrimitive } from "radix-ui"
import type * as React from "react"

type Props = React.ComponentProps<typeof DialogPrimitive.Title> & JsxStyleProps

const titleStyles = cva({
  base: {
    alignItems: "center",
    display: "flex",
    gap: "1.5",
    textStyle: "modalTitle",
  },
})

const StyledSheetTitle = styled(DialogPrimitive.Title, titleStyles)

export const SheetTitle = (props: Props) => {
  return <StyledSheetTitle {...props} />
}
