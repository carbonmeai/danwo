import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import type React from "react"

const separatorStyles = cva({
  base: { bg: "background.muted", h: "1px", my: "4px" },
})

const StyledSeparator = styled(ContextMenuPrimitive.Separator, separatorStyles)

export const ContextMenuSeparator = ({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) => {
  return <StyledSeparator data-slot="context-menu-separator" {...props} />
}
