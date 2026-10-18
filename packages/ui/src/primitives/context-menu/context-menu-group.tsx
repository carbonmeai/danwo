import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"

const StyledGroup = styled(ContextMenuPrimitive.Group)

export const ContextMenuGroup = ({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Group> & JsxStyleProps) => {
  return <StyledGroup data-slot="context-menu-group" {...props} />
}
