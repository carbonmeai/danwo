import { css, cx, type RecipeVariantProps } from "@danwo/ui/css"
import { Box, Flex, styled } from "@danwo/ui/jsx"
import * as React from "react"
import { Children, isValidElement } from "react"

import type { AvatarProps } from "./avatar"
import { avatarRootStyle } from "./avatar-styles"

const getValidChildren = (children: React.ReactNode) => {
  return Children.toArray(children).filter((child) => isValidElement(child)) as React.ReactElement[]
}

const Excess = styled(Box, avatarRootStyle)

type Variants = RecipeVariantProps<typeof avatarRootStyle>

export const AvatarGroup = React.forwardRef<
  HTMLDivElement,
  { max: number } & React.BaseHTMLAttributes<HTMLDivElement> & Variants
>(function AvatarGroup({ max, size, radius, children, ...props }, ref) {
  // get valid react children
  const validChildren = getValidChildren(children)
  /**
   * get the avatars within the max
   */
  const childrenWithinMax = max != null ? validChildren.slice(0, max) : validChildren
  /**
   * get the remaining avatar count
   */
  const excess = max != null ? validChildren.length - max : 0

  // const reversedChildren = childrenWithinMax.reverse()
  return (
    <Flex
      align="center"
      className={cx(
        css({
          "& > div:not(:first-child)": {
            // marginLeft:
          },
        }),
      )}
      ref={ref}
      {...props}
    >
      {childrenWithinMax.map((child, index) => {
        return React.cloneElement(child, {
          key: child.key,
          radius: radius,
          style: { marginInlineEnd: `-0.25rem`, zIndex: index },
        } as Partial<AvatarProps>)
      })}
      {excess > 0 && (
        <Excess
          alignItems="center"
          bg="color.gray.2"
          border="subtle"
          display="flex"
          justifyContent="center"
          radius={radius}
          size={size}
          style={{
            marginInlineEnd: `-0.25rem`,
            zIndex: childrenWithinMax.length,
          }}
        >{`+${excess}`}</Excess>
      )}
      {/* This is to account for the inline-margin above */}
      <Box w="0.25rem" />
    </Flex>
  )
})
