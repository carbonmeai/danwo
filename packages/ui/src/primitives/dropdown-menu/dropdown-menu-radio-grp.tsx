import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

const StyledRadioGroup = styled(DropdownMenuPrimitive.RadioGroup)

export const DropdownMenuRadioGroup = ({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup> & JsxStyleProps) => {
  return <StyledRadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}
