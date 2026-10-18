import { defineTokens } from "@pandacss/dev"

export const animations = defineTokens.animations({
  accordionDown: {
    value: "accordionSlideDown 300ms cubic-bezier(0.87, 0, 0.13, 1)",
  },

  // accordion
  accordionUp: {
    value: "accordionSlideUp 300ms cubic-bezier(0.87, 0, 0.13, 1)",
  },

  // gradients
  animatedGradient: {
    value: "animatedgradient 3s ease alternate infinite",
  },

  // text
  caretBlink: {
    value: "caretBlink 1.25s ease-out infinite",
  },
  ellipsis: {
    value: "ellipsis steps(4, end) 900ms infinite",
  },
  fadeElementIn: {
    value: "fadeIn 400ms ease-out",
  },
  fadeElementOut: {
    value: "fadeOut 400ms ease-out",
  },
  // spinner
  loader: {
    value: "spinner 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite",
  },
  modalClose: {
    value: "fadeOut 400ms ease-out",
  },

  //modal
  modalOpen: {
    value: "fadeIn 400ms ease-in",
  },
  // ping (notification dot)
  ping: {
    value: "ping 1s cubic-bezier(0, 0, 0.2, 1) infinite",
  },
  popoverDownIn: {
    value: "slideDownAndFade 400ms cubic-bezier(0.16, 1, 0.3, 1)",
  },
  popoverHide: {
    value: "fadeOut 400ms ease-out",
  },
  popoverLeftIn: {
    value: "slideLeftAndFade 400ms cubic-bezier(0.16, 1, 0.3, 1)",
  },
  popoverRightIn: {
    value: "slideRightAndFade 400ms cubic-bezier(0.16, 1, 0.3, 1)",
  },

  // popover
  popoverUpIn: {
    value: "slideUpAndFade 400ms cubic-bezier(0.16, 1, 0.3, 1)",
  },
  pulsate: {
    value: "2s cubic-bezier(0.4, 0, 0.6, 1) 0s infinite normal none running pulse",
  },

  // sheet slide animations
  slideInLeft: {
    value: "slideInLeft 500ms ease-in-out",
  },
  slideInRight: {
    value: "slideInRight 500ms ease-in-out",
  },
  slideOutLeft: {
    value: "slideOutLeft 300ms ease-in-out",
  },
  slideOutRight: {
    value: "slideOutRight 300ms ease-in-out",
  },

  // toast
  toastIn: {
    value: "toastSlideIn 150ms cubic-bezier(0.16, 1, 0.3, 1)",
  },
  toastOut: {
    value: "toastHide 100ms ease-out",
  },
})
