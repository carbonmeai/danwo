import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"

const listStyles = cva({
  base: {
    "&[data-empty]": {
      p: "0",
    },
    maxH: "calc(min(18rem - 2.25rem, var(--available-height) - 2.25rem))",
    overflowY: "auto",
    overscrollBehavior: "contain",
    p: "1",
    scrollbar: "hidden",
    scrollPaddingY: "1",
  },
})

const StyledList = styled(ComboboxPrimitive.List, listStyles)

export type ComboboxListProps = ComboboxPrimitive.List.Props & JsxStyleProps

export const ComboboxList = ({ ...props }: ComboboxListProps) => {
  return <StyledList data-slot="combobox-list" {...props} />
}
