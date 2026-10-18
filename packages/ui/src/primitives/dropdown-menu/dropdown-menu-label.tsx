import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import type * as React from "react"

type Props = React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
} & JsxStyleProps

const styles = cva({
  base: { px: "1.5", py: "1", textStyle: "label", userSelect: "none" },
})

const StyledLabel = styled(DropdownMenuPrimitive.Label, styles)

export const DropdownMenuLabel = ({ className, ...props }: Props) => {
  return (
    <StyledLabel
      className={className}
      data-slot="dropdown-menu-label"
      textStyle="label"
      {...props}
    />
  )
}
