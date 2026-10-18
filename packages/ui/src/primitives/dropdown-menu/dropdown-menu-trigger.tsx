import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

const StyledTrigger = styled(DropdownMenuPrimitive.Trigger)

export const DropdownMenuTrigger = ({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger> & JsxStyleProps) => {
  return <StyledTrigger data-slot="dropdown-menu-trigger" {...props} />
}
