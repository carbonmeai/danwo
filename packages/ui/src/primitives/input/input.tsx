import { Input as InputPrimitive } from "@base-ui/react/input"
import type { RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

import { inputStyles } from "./input-styles"

const StyledInput = styled(InputPrimitive, inputStyles)

export type InputVariants = RecipeVariantProps<typeof inputStyles>

export type InputProps = Omit<React.ComponentProps<"input">, "size"> & JsxStyleProps & InputVariants

export const Input = ({ size = "xs", ...props }: InputProps) => {
  return <StyledInput data-slot="input" size={size} {...props} />
}
