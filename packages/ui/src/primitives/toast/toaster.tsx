import { css, cx } from "@danwo/ui/css"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { Icons } from "../../icons/base"
import { buttonStyle } from "../button/button-styles"

const baseToastStyles = css.raw({
  alignItems: "center",
  bg: "background.popover",
  borderColor: "brand.panel.10",
  borderStyle: "solid",
  borderWidth: "1px",
  boxShadow: "sLg",
  color: "text.app",
  columnGap: "2.5",
  display: "flex",
  overflow: "hidden",
  p: "2.5",
  rounded: "xl",
  w: "full",
})

/* Typed toasts keep the popover surface and add a tint, a coloured border, a left accent bar and icon. */
const variantStyles = {
  error: css.raw({
    "& [data-icon]": { color: "brand.error.11" },
    _before: { bg: "brand.error.9" },
    bgImage:
      "linear-gradient(90deg, token(colors.brand.error.3) 0%, token(colors.brand.error.1) 100%)",
    borderColor: "brand.error.7",
  }),
  info: css.raw({
    "& [data-icon]": { color: "brand.info.11" },
    _before: { bg: "brand.info.9" },
    bgImage:
      "linear-gradient(90deg, token(colors.brand.info.3) 0%, token(colors.brand.info.1) 100%)",
    borderColor: "brand.info.7",
  }),
  success: css.raw({
    "& [data-icon]": { color: "brand.success.11" },
    _before: { bg: "brand.success.9" },
    bgImage:
      "linear-gradient(90deg, token(colors.brand.success.3) 0%, token(colors.brand.success.1) 100%)",
    borderColor: "brand.success.7",
  }),
  warning: css.raw({
    "& [data-icon]": { color: "brand.warning.11" },
    _before: { bg: "brand.warning.9" },
    bgImage:
      "linear-gradient(90deg, token(colors.brand.warning.3) 0%, token(colors.brand.warning.1) 100%)",
    borderColor: "brand.warning.7",
  }),
}

const accentBar = css.raw({
  _before: {
    content: '""',
    insetBlock: "0",
    insetInlineStart: "0",
    position: "absolute",
    w: "3px",
  },
})

const typedToast = (type: keyof typeof variantStyles) =>
  css(baseToastStyles, accentBar, variantStyles[type])

export const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      className="toaster group"
      icons={{
        error: <Icons.close className="size-4" />,
        info: <Icons.infoCircle className="size-4" />,
        loading: <Icons.loading animation="loader" className="size-4" />,
        success: <Icons.check className="size-4" />,
        warning: <Icons.warn className="size-4" />,
      }}
      theme={theme as ToasterProps["theme"]}
      toastOptions={{
        classNames: {
          // Buttons keep their label on one line beside a long message.
          actionButton: cx(
            buttonStyle({ size: "xs", variant: "outline" }),
            css({
              colorPalette: "palette.gray",
              cursor: "pointer",
              flexShrink: "0",
              whiteSpace: "nowrap",
            }),
          ),
          cancelButton: cx(
            buttonStyle({ size: "xs", variant: "ghost" }),
            css({
              colorPalette: "palette.gray",
              cursor: "pointer",
              flexShrink: "0",
              whiteSpace: "nowrap",
            }),
          ),
          default: css(baseToastStyles),
          description: css({
            color: "text.muted",
            fontSize: "1",
            fontWeight: "500",
          }),
          error: typedToast("error"),
          info: typedToast("info"),
          loading: css(baseToastStyles),
          success: typedToast("success"),
          title: css({ fontSize: "2", fontWeight: "500" }),
          warning: typedToast("warning"),
        },
        unstyled: true,
      }}
      {...props}
    />
  )
}
