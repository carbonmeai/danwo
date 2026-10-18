import type { RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Avatar as AvatarPrimitive } from "radix-ui"
import * as React from "react"

import { avatarRootStyle } from "./avatar-styles"

type Element = React.ElementRef<typeof AvatarPrimitive.Root>

const StyledAvatar = styled(AvatarPrimitive.Root, avatarRootStyle)

export type AvatarVariants = RecipeVariantProps<typeof avatarRootStyle>

export type AvatarProps = React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root> &
  AvatarVariants &
  JsxStyleProps

export const Avatar = React.forwardRef<Element, AvatarProps>(function Avatar({ ...props }, ref) {
  return <StyledAvatar ref={ref} {...props} />
})
