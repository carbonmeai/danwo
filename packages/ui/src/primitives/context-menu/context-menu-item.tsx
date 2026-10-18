import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps, RecipeVariantProps } from "@danwo/ui/types"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import type React from "react"

const itemStyles = cva({
  base: {
    _disabled: {
      cursor: "not-allowed",
      opacity: 0.6,
      pointerEvents: "none",
    },
    _focus: {
      bg: "background.muted",
    },
    "&[data-highlighted]": {
      bg: "background.muted",
    },
    alignItems: "center",
    colorPalette: "palette.gray",
    cursor: "pointer",
    display: "flex",
    fontSize: "1",
    gap: "2.5",
    mb: "0.5",
    outline: "none",
    pos: "relative",
    px: "1",
    py: "1",
    rounded: "8px",
    transition: "colors 200ms",
    userSelect: "none",
  },
  defaultVariants: {
    look: "transparent",
    size: "xs",
  },
  variants: {
    look: {
      soft: {
        _hover: {
          bg: "colorPalette.4",
        },

        _light: {
          color: "colorPalette.11",
        },

        "& .spinner, & .spinner *": {
          borderTopColor: "colorPalette.11",
        },

        "&[data-state=active], &[data-state=on], &[data-state=open]": {
          bg: "colorPalette.9",
          color: "color.gray.1",
          opacity: "1",
        },
        bg: "colorPalette.3",
        color: "colorPalette.12",
      },
      transparent: {
        _hover: {
          bg: "colorPalette.3",
        },

        "&[data-state=active], &[data-state=on], &[data-state=open]": {
          _hover: {
            bg: "colorPalette.3",
          },
          bg: "colorPalette.3",
          opacity: "1",
        },
        bg: "transparent",
        color: "colorPalette.12",
      },
    },
    size: {
      auto: {},
      md: {
        fontSize: "2",
        h: "3.8rem",
        px: "3.2",
        rounded: "xl",
      },
      sm: {
        fontSize: "2",
        h: "3.2rem",
        px: "1.5",
        rounded: "lg",
      },
      xs: {
        fontSize: "1",
        h: "2.8rem",
        px: "1.5",
        rounded: "lg",
      },
    },
  },
})

const StyledDropdownItem = styled(ContextMenuPrimitive.Item, itemStyles)

type Props = React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  disablePropagation?: boolean
} & JsxStyleProps &
  RecipeVariantProps<typeof itemStyles>

export const ContextMenuItem = ({ inset, ...props }: Props) => {
  return (
    <StyledDropdownItem
      data-slot="context-menu-item"
      style={{ paddingLeft: inset ? "1.6rem" : undefined }}
      {...props}
    />
  )
}
