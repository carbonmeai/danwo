import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps, RecipeVariantProps } from "@danwo/ui/types"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import type * as React from "react"

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
    gap: "1",
    mb: "0.5",
    outline: "none",
    pos: "relative",
    transition: "colors 200ms",
    userSelect: "none",
  },
  defaultVariants: {
    size: "xs",
    variant: "transparent",
  },
  variants: {
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
        h: "1.75rem",
        px: "1.5",
        rounded: "lg",
      },
    },
    variant: {
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
          bg: "background.muted",
        },

        "&[data-state=active], &[data-state=on], &[data-state=open]": {
          _hover: {
            bg: "background.muted",
          },
          bg: "background.muted",
          opacity: "1",
        },
        bg: "transparent",
        color: "colorPalette.12",
      },
    },
  },
})

const StyledDropdownItem = styled(DropdownMenuPrimitive.Item, itemStyles)

type Props = React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  disablePropagation?: boolean
} & JsxStyleProps &
  RecipeVariantProps<typeof itemStyles>

export const DropdownMenuItem: React.FC<Props> = ({ inset, disablePropagation, ...props }) => {
  return (
    <StyledDropdownItem
      data-slot="dropdown-menu-item"
      onClick={(event) => disablePropagation && event.stopPropagation()}
      style={{ paddingLeft: inset ? "1.6rem" : undefined }}
      {...props}
    />
  )
}
