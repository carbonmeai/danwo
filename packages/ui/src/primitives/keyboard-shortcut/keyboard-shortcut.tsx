import { cva, type RecipeVariantProps } from "@danwo/ui/css"
import { type BoxProps, styled } from "@danwo/ui/jsx"

const styles = cva({
  base: {
    display: "flex",
    gap: "0.5",
    opacity: "0.8",
    px: "0.5",
    py: "1px",
  },
  defaultVariants: {
    size: "sm",
  },
  variants: {
    size: {
      attribute: {},
      auto: {},
      icon: {
        rounded: "sm",
      },
      lg: {
        my: "2",
        rounded: "lg",
      },
      md: {
        my: "2",
        rounded: "md",
      },
      sm: {
        my: "2",
        rounded: "sm",
      },
      xs: {
        rounded: "sm",
      },
      xxs: {
        rounded: "sm",
      },
    },
  },
})

type Props = RecipeVariantProps<typeof styles> & BoxProps

const StyledWrapper = styled("div", styles)

export const KeyboardShortcut = ({ children, ...rest }: Props) => {
  return <StyledWrapper {...rest}>{children}</StyledWrapper>
}
