import { defineGlobalStyles } from "@pandacss/dev"

export const globalCss = defineGlobalStyles({
  /* to control scrollbars on different browsers */
  "::-webkit-scrollbar": {
    h: "0.375rem",
    w: "0.25rem",
  },

  "::-webkit-scrollbar-thumb": {
    "&:hover": {
      bg: "background.mutedNoAlpha",
    },
    bg: "background.mutedNoAlpha",
    // rounded: 'xl'
  },

  "::-webkit-scrollbar-track": {
    "&:hover": {
      bg: "background.muted",
    },
    rounded: "0.2rem",
  },

  ".empty-state-illustration": {
    color: "text.illustration",
  },

  ".hidden-scrollbar": {
    "&::-webkit-scrollbar": {
      display: "none",
    },
  },

  "*": {
    "&:focus-visible": {
      // border: 'subtle'
    },
    outline: "none",
  },

  body: {
    /*
     * same paint as html — a transiently unpainted compositor layer (e.g. a fixed
     * panel mid-transition during a route switch) must never show through as black
     */
    backgroundColor: "background.app",
    fontFamily: "sans",
    fontSize: "2",
    fontWeight: "400",
    height: "100vh",
    overflow: "hidden",
  },

  html: {
    backgroundColor: "background.app",
    color: "text.app",
    fontFamily: "sans",
    fontSize: "16px",
  },

  // file upload button override
  "input[type=file]::-webkit-file-upload-button": {
    cursor: "pointer",
  },

  kbd: {
    font: "unset",
  },
})
