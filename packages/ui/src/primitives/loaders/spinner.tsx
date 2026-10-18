import type { RecipeVariantProps } from "@danwo/ui/css"

import { Icons } from "../../icons/base"
import { spinnerStyle } from "./spinner-styles"

export type SpinnerProps = {
  size?: "attribute" | "auto" | "icon" | "lg" | "md" | "sm" | "xs" | "xxs"
} & SpinnerVariants

export type SpinnerVariants = RecipeVariantProps<typeof spinnerStyle>

export const Spinner = ({ size = "md" }: SpinnerProps) => {
  return <Icons.loading animation="loader" className={spinnerStyle({ size })} size={size} />
}
