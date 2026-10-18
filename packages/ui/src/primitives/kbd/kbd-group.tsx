import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const kbdGroupStyles = cva({
  base: {
    alignItems: "center",
    display: "inline-flex",
    gap: "1",
  },
})

const StyledKbdGroup = styled("div", kbdGroupStyles)

export type KbdGroupVariants = RecipeVariantProps<typeof kbdGroupStyles>

export type KbdGroupProps = React.ComponentProps<"div"> & KbdGroupVariants & JsxStyleProps

export const KbdGroup = (props: KbdGroupProps) => {
  return <StyledKbdGroup data-slot="kbd-group" {...props} />
}
