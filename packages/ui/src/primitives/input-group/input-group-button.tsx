import { cva, cx, type RecipeVariantProps } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import { Slot } from "radix-ui"

import { Button, type ButtonProps } from "../button/button"

const inputGroupButtonStyles = cva({
  base: {
    _hover: {
      bg: "transparent",
    },
    alignItems: "center",
    bg: "transparent",
    display: "flex",
    fontSize: "1",
    gap: "2",
    shadow: "none",
  },
  defaultVariants: {
    size: "xs",
  },
  variants: {
    size: {
      "icon-sm": {
        "&:has(> svg)": {
          p: "0",
        },
        h: "2rem",
        p: "0",
        w: "2rem",
      },
      "icon-xs": {
        "&:has(> svg)": {
          p: "0",
        },
        h: "1.5rem",
        p: "0",
        rounded: "md",
        w: "1.5rem",
      },
      sm: {},
      xs: {
        '& > svg:not([class*="size-"])': {
          h: "3.5",
          w: "3.5",
        },
        gap: "1",
        h: "1.5rem",
        px: "1.5",
        rounded: "md",
      },
    },
  },
})

const StyledInputGroupButton = styled(Button, inputGroupButtonStyles)
const StyledSlot = styled(Slot.Root)

export type InputGroupButtonVariants = RecipeVariantProps<typeof inputGroupButtonStyles>

export type InputGroupButtonProps = Omit<ButtonProps, "size"> &
  InputGroupButtonVariants & {
    type?: "button" | "submit" | "reset"
    asChild?: boolean
  }

export const InputGroupButton = ({
  type = "button",
  variant = "transparent",
  size = "xs",
  asChild = false,
  className,
  ...props
}: InputGroupButtonProps) => {
  return asChild ? (
    <StyledSlot
      className={cx(inputGroupButtonStyles({ size }), className)}
      data-size={size}
      data-slot="input-group-button"
      {...props}
    />
  ) : (
    <StyledInputGroupButton
      data-size={size}
      data-slot="input-group-button"
      size={size}
      type={type}
      variant={variant}
      {...props}
    />
  )
}
