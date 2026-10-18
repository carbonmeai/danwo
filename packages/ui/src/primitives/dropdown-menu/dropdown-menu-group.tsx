import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

const StyledGroup = styled(DropdownMenuPrimitive.Group)

export const DropdownMenuGroup = ({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group> & JsxStyleProps) => {
  return <StyledGroup data-slot="dropdown-menu-group" {...props} />
}
