import { defineTokens } from "@pandacss/dev"

export const borders = defineTokens.borders({
  error: { value: "1px solid {colors.brand.error.7}" },
  focused: { value: "1px solid {colors.brand.primary.9}" },
  info: { value: "1px solid {colors.brand.info.4}" },
  none: { value: "none" },
  subtle: { value: "1px solid {colors.brand.panel.4}" },
  success: { value: "1px solid {colors.brand.success.4}" },
  warning: { value: "1px solid {colors.brand.warning.4}" },
})
