import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"

import { Icons } from "../../icons/base"
import { InputGroupButton } from "../input-group/input-group-button"

const StyledClear = styled(ComboboxPrimitive.Clear)

export type ComboboxClearProps = ComboboxPrimitive.Clear.Props & JsxStyleProps

export const ComboboxClear = ({ ...props }: ComboboxClearProps) => {
  return (
    <StyledClear
      data-slot="combobox-clear"
      render={
        <InputGroupButton size="icon-xs" variant="transparent">
          <Icons.close pointerEvents="none" size={14} />
        </InputGroupButton>
      }
      {...props}
    />
  )
}
