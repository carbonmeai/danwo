import { css, cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps, RecipeVariantProps } from "@danwo/ui/types"
import { Select as SelectPrimitive } from "radix-ui"
import type * as React from "react"

import { Icons } from "../../icons/base"
import { Span } from "../typography"

const selectItemStyles = cva({
  base: {
    _disabled: {
      opacity: "0.5",
      pointerEvents: "none",
    },

    _focus: {
      bg: "background.muted",
    },

    _hover: {
      bg: "background.muted",
    },

    "&[data-highlighted]": {
      bg: "background.muted",
    },
    alignItems: "center",
    cursor: "pointer",
    display: "flex",
    fontSize: "1",
    outline: "none",
    position: "relative",
    px: "2.5",
    py: "2.5",
    rounded: "xl",
    userSelect: "none",
    w: "100%",
  },
  defaultVariants: {
    size: "xs",
  },
  variants: {
    size: {
      auto: {},
      lg: {
        fontSize: 3,
        h: "2.5rem",
        px: "3.5",
        rounded: "xl",
      },
      md: {
        fontSize: 2,
        h: "2.25rem",
        px: "4",
        rounded: "lg",
      },
      sm: {
        fontSize: 2,
        h: "2rem",
        px: "3",
        rounded: "lg",
      },
      xs: {
        fontSize: 1,
        h: "1.75rem",
        px: "1.5",
        rounded: "lg",
      },
    },
  },
})

const StyledItem = styled(SelectPrimitive.Item, selectItemStyles)

export const SelectItem = ({
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> &
  JsxStyleProps &
  RecipeVariantProps<typeof selectItemStyles>) => {
  return (
    <StyledItem
      {...props}
      css={[
        ...[props.css ?? {}].flat(),
        {
          "&[data-highlighted]": {
            bg: "background.muted",
          },
        },
      ]}
    >
      <Span
        alignItems="center"
        display="flex"
        h="0.875rem"
        justifyContent="center"
        pos="absolute"
        right="8px"
        w="0.875rem"
      >
        <SelectPrimitive.ItemIndicator>
          <Icons.check className={css({ h: "0.875rem", w: "0.875rem" })} />
        </SelectPrimitive.ItemIndicator>
      </Span>

      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </StyledItem>
  )
}
