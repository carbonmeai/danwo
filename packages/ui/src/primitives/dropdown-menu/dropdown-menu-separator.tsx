import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import type * as React from "react"

const separatorStyles = cva({
  base: { bg: "background.muted", h: "1px", mx: "-1", my: "4px" },
})

const StyledSeparator = styled(DropdownMenuPrimitive.Separator, separatorStyles)

export const DropdownMenuSeparator = (
  props: React.ComponentProps<typeof DropdownMenuPrimitive.Separator> & JsxStyleProps,
) => {
  return <StyledSeparator data-slot="dropdown-menu-separator" {...props} />
}
