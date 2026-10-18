import { defineKeyframes } from "@pandacss/dev"

export const keyframes = defineKeyframes({
  fieldComputing: {
    "0%, 100%": {
      boxShadow: "0 0 6px token(colors.palette.violet.8), 0 0 0 0 token(colors.palette.violet.4)",
    },
    "70%": {
      boxShadow: "0 0 6px token(colors.palette.violet.8), 0 0 0 5px transparent",
    },
  },
  // accordion
  accordionSlideDown: {
    from: {
      height: 0,
    },
    to: {
      height: "var(--radix-accordion-content-height)",
    },
  },
  accordionSlideUp: {
    from: {
      height: "var(--radix-accordion-content-height)",
    },
    to: {
      height: 0,
    },
  },
  // gradients
  animatedgradient: {
    "0%": {
      backgroundPosition: "0% 50%",
    },
    "50%": {
      backgroundPosition: "100% 50%",
    },
    "100%": {
      backgroundPosition: "0% 50%",
    },
  },
  // text
  caretBlink: {
    "0%,70%,100%": { opacity: 0 },
    "20%,50%": { opacity: 1 },
  },
  ellipsis: {
    from: {
      width: "0",
    },
    to: {
      width: "1.25em",
    },
  },
  // general
  fadeIn: {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },
  fadeOut: {
    from: { opacity: 1 },
    to: { opacity: 0 },
  },
  oastSlideIn: {
    from: {
      transform: "translateX(calc(100% + var(--viewport-padding)))",
    },
    to: {
      transform: "translateX(0)",
    },
  },
  // ping (notification dot)
  ping: {
    "75%, 100%": {
      opacity: 0,
      transform: "scale(2)",
    },
  },
  pop: {
    from: {
      transform: "scale(1)",
    },
    to: {
      transform: "scale(var(--scale))",
    },
  },
  popover: {
    from: {
      opacity: 0,
      transform: "scale(0.95) translateY(-2px)",
    },
    to: {
      opacity: 1,
      transform: "scale(1) translateY(0)",
    },
  },
  // pulse
  pulse: {
    "50%": { opacity: 0.5 },
  },

  slideDownAndFade: {
    from: { opacity: 0, transform: "translateY(-2px)" },
    to: { opacity: 1, transform: "translateY(0)" },
  },
  slideInLeft: {
    from: {
      opacity: 0,
      transform: "translateX(-100%)",
    },
    to: {
      opacity: 1,
      transform: "translateX(0)",
    },
  },
  slideInRight: {
    from: {
      opacity: 0,
      transform: "translateX(100%)",
    },
    to: {
      opacity: 1,
      transform: "translateX(0)",
    },
  },
  slideLeftAndFade: {
    from: { opacity: 0, transform: "translateX(2px)" },
    to: { opacity: 1, transform: "translateX(0)" },
  },
  slideOutLeft: {
    from: {
      opacity: 1,
      transform: "translateX(0)",
    },
    to: {
      opacity: 0,
      transform: "translateX(-100%)",
    },
  },
  slideOutRight: {
    from: {
      opacity: 1,
      transform: "translateX(0)",
    },
    to: {
      opacity: 0,
      transform: "translateX(100%)",
    },
  },
  slideRightAndFade: {
    from: { opacity: 0, transform: "translateX(-2px)" },
    to: { opacity: 1, transform: "translateX(0)" },
  },
  // popovers
  slideUpAndFade: {
    from: { opacity: 0, transform: "translateY(2px)" },
    to: { opacity: 1, transform: "translateY(0)" },
  },
  // loaders
  spinner: {
    "0%": { transform: "rotate(0deg)" },
    "100%": { transform: "rotate(360deg)" },
  },
  // toasts
  toastHide: {
    from: {
      opacity: "1",
    },
    to: {
      opacity: "0",
    },
  },
  toastSwipeOut: {
    from: {
      transform: "translateX(var(--radix-toast-swipe-end-x))",
    },
    to: {
      transform: "translateX(calc(100% + var(--viewport-padding)))",
    },
  },
})
