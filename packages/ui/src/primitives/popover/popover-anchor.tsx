import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Popover as PopoverPrimitive } from "radix-ui"

const StyledAnchor = styled(PopoverPrimitive.Anchor, {
  base: {
    w: "full",
  },
})

type Props = React.ComponentProps<typeof PopoverPrimitive.Anchor> & {
  inset?: boolean
} & JsxStyleProps

export const PopoverAnchor = ({ ...props }: Props) => {
  return <StyledAnchor data-slot="popover-anchor" {...props} />
}
