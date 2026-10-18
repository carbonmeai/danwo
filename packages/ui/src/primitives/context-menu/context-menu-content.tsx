import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import type React from "react"

type Props = React.ComponentProps<typeof ContextMenuPrimitive.Content> & {
  inset?: boolean
} & JsxStyleProps

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
    mx: "1rem",
    overflow: "hidden",
    rounded: "2xl",
    zIndex: "100",
  },
})

const StyledContent = styled(ContextMenuPrimitive.Content, contentStyles)

export const ContextMenuContent = ({ ...props }: Props) => {
  return (
    <ContextMenuPrimitive.Portal>
      <StyledContent data-slot="context-menu-content" {...props} />
    </ContextMenuPrimitive.Portal>
  )
}
