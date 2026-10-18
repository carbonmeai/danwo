import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { Box, Flex, styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Command as CommandPrimitive } from "cmdk"
import type * as React from "react"

import { Icons } from "../../icons/base"

const commandInputStyles = cva({
  base: {
    _disabled: {
      cursor: "not-allowed",
      opacity: "0.7",
      pointerEvents: "none",
    },

    _placeholder: {
      color: "text.placeholder",
    },
    bg: "transparent",
    outline: "none",
    w: "full",
  },
  defaultVariants: {
    look: "ghost",
    use: "xs",
  },
  variants: {
    look: {
      editable: {
        _focus: {
          border: "focused",
        },

        _hover: {
          bg: "background.muted",
        },
        border: "none",
      },
      form: {
        _focus: {
          border: "focused",
        },
        border: "subtle",
      },
      ghost: {},
      subtle: {
        _focus: {
          border: "focused",
        },
        border: "subtle",
      },
      transparent: {
        _focus: {
          border: "focused",
        },

        _hover: {
          bg: "background.muted",
        },
        border: "none",
      },
    },
    showIcon: {
      false: {},
      true: {},
    },
    use: {
      auto: {},
      lg: {
        fontSize: "3",
        h: "2.5rem",
        px: "3.5",
        rounded: "xl",
      },
      md: {
        fontSize: "2",
        h: "2.25rem",
        px: "3.5",
        rounded: "xl",
      },
      sm: {
        fontSize: "1",
        h: "2rem",
        px: "3",
        rounded: "lg",
      },
      xs: {
        fontSize: "1",
        h: "1.75rem",
        px: "1.5",
        rounded: "lg",
      },
    },
  },
})

export type CommandInputVariants = RecipeVariantProps<typeof commandInputStyles>

type Props = React.ComponentProps<typeof CommandPrimitive.Input> & {
  icon?: React.ReactNode
  wrapperProps?: React.ComponentProps<typeof Flex>
  iconWrapperProps?: React.ComponentProps<typeof Box>
} & JsxStyleProps &
  CommandInputVariants

const StyledCommandInput = styled(CommandPrimitive.Input, commandInputStyles)

export const CommandInput = ({
  wrapperProps,
  use = "xs",
  icon,
  showIcon,
  iconWrapperProps,
  ...props
}: Props) => {
  return (
    <Flex
      align="center"
      cmdk-input-wrapper=""
      data-slot="command-input-wrapper"
      gap="2"
      pos="relative"
      w="full"
      {...wrapperProps}
    >
      {showIcon && (
        <Box {...iconWrapperProps}>{icon ? icon : <Icons.searchNormal size={12} />}</Box>
      )}
      <StyledCommandInput showIcon={showIcon} use={use} {...props} />
    </Flex>
  )
}
