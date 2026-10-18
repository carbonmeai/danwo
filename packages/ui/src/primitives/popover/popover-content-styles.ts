import { cva } from "@danwo/ui/css"

export const popoverContentStyles = cva({
  base: {
    _light: {
      bg: "white",
      glass: "none",
    },
    "&[data-state=closed]": {
      animation: "popoverHide",
    },
    "&[data-state=open]": {
      animation: "popoverUpIn",
    },
    bg: "background.popover",
    border: "subtle",
    glass: "popup",
    // the recipe had no padding, so every caller's content sat on the border
    p: "2",
    rounded: "xl",
    shadow: "sSm",
    zIndex: "100",
  },
})
