import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"

const chipsInputStyles = cva({
  base: {
    flex: "1",
    minW: "4rem",
    outline: "none",
  },
})

const StyledChipsInput = styled(ComboboxPrimitive.Input, chipsInputStyles)

export type ComboboxChipsInputProps = ComboboxPrimitive.Input.Props & JsxStyleProps

export const ComboboxChipsInput = ({ ...props }: ComboboxChipsInputProps) => {
  return <StyledChipsInput data-slot="combobox-chip-input" {...props} />
}
