import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Avatar as AvatarPrimitive } from "radix-ui"
import * as React from "react"

type Element = React.ElementRef<typeof AvatarPrimitive.Image>

const avatarImageStyle = cva({
  base: {
    aspectRatio: "square",
    h: "100%",
    w: "100%",
  },
})

const StyledAvatarImage = styled(AvatarPrimitive.AvatarImage, avatarImageStyle)

export type AvatarImageProps = React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image> &
  JsxStyleProps

export const AvatarImage = React.forwardRef<Element, AvatarImageProps>(function AvatarImage(
  { ...props },
  ref,
) {
  return <StyledAvatarImage ref={ref} {...props} />
})
