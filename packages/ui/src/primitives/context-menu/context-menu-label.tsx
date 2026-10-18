import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import type React from "react"

type Props = React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean
} & JsxStyleProps

const styles = cva({
  base: { my: "4px" },
})

const StyledLabel = styled(ContextMenuPrimitive.Label, styles)

export const ContextMenuLabel = ({ ...props }: Props) => {
  return <StyledLabel data-slot="context-menu-label" {...props} />
}
