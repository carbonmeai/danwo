import { cva } from "@danwo/ui/css"

export const spinnerStyle = cva({
  base: {
    animation: "spin 1s linear infinite",
  },
  variants: {
    size: {
      attribute: {},
      auto: {},
      icon: {
        h: "1.4rem",
        w: "1.4rem",
      },
      lg: {
        h: "2.5rem",
        w: "2.5rem",
      },
      md: {
        h: "2rem",
        w: "2rem",
      },
      sm: {
        h: "1.6rem",
        w: "1.6rem",
      },
      xs: {
        h: "1.4rem",
        w: "1.4rem",
      },
      xxs: {
        h: "1.4rem",
        w: "1.4rem",
      },
    },
  },
})
