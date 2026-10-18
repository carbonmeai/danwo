import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"

const StyledGroup = styled(ComboboxPrimitive.Group)

export type ComboboxGroupProps = ComboboxPrimitive.Group.Props & JsxStyleProps

export const ComboboxGroup = ({ ...props }: ComboboxGroupProps) => {
  return <StyledGroup data-slot="combobox-group" {...props} />
}
