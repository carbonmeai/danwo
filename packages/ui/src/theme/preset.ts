import { definePreset } from "@pandacss/dev"

import { animations } from "./animations"
import { borders } from "./borders"
import { breakpoints } from "./breakpoints"
import { colors, RUNTIME_COLOR_PALETTES, semanticColors } from "./colors"
import { globalCss } from "./global"
import { keyframes } from "./keyframes"
import { opacity } from "./opacity"
import { radii } from "./radii"
import { semanticShadows, shadows } from "./shadows"
import { sizes } from "./sizes"
import { spacing } from "./spacing"
import { glass } from "./translucence"
import {
  fontSizes,
  fonts,
  fontWeights,
  letterSpacings,
  lineHeights,
  textStyles,
} from "./typography"

export const danwoUi = definePreset({
  conditions: {
    dark: '&.dark, .dark &, &[data-theme="dark"], [data-theme="dark"] &',
    inComboboxContentFocusWithin: "[data-slot=combobox-content] &:focus-within",
    light: '&.light, .light &, &[data-theme="light"], [data-theme="light"] &',
    reactFlowNodeSelected: ".react-flow__node.selected &",
  },
  globalCss,
  name: "danwo-ui",
  staticCss: {
    css: [
      {
        properties: {
          colorPalette: RUNTIME_COLOR_PALETTES,
        },
      },
    ],
  },
  theme: {
    colorPalette: {
      include: ["palette.*", "brand.*"],
    },
    containerNames: ["field-group"],
    containerSizes: {
      lg: "1280px",
      md: "1024px",
      sm: "768px",
      xl: "1640px",
      xs: "520px",
    },
    extend: {
      breakpoints,
      keyframes,
      textStyles,
    },
    semanticTokens: {
      colors: semanticColors,
      shadows: semanticShadows,
    },
    tokens: {
      animations,
      borders,
      colors,
      fontSizes,
      fonts,
      fontWeights,
      letterSpacings,
      lineHeights,
      opacity,
      radii,
      shadows,
      sizes,
      spacing,
    },
  },
  utilities: {
    glass,
  },
})

export { RUNTIME_COLOR_PALETTES, USER_COLORS } from "./colors"
