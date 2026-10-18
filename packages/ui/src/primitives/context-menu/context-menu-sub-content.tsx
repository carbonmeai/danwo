import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import type React from "react"

const contentStyles = cva({
  base: {
    "&[data-state=closed]": {
      animation: "popoverHide",
    },

    "&[data-state=open]": {
      animation: "popoverUpIn",
    },
    bg: "background.popover",
    border: "subtle",
    glass: "popup",
    minW: "8rem",
    mt: "-0.5rem",
    mx: "1rem",
    my: "0",
    overflow: "hidden",
    rounded: "2xl",
    zIndex: "100",
  },
})

const StyledSubContent = styled(ContextMenuPrimitive.SubContent, contentStyles)

type Props = React.ComponentProps<typeof ContextMenuPrimitive.SubContent> & {
  inset?: boolean
} & JsxStyleProps

export const ContextMenuSubContent = ({ ...props }: Props) => {
  return (
    <ContextMenuPrimitive.Portal>
      <StyledSubContent data-slot="context-menu-sub-content" {...props} />
    </ContextMenuPrimitive.Portal>
  )
}
