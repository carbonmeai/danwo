import { defineLayerStyles } from "@pandacss/dev"

export const layerStyles = defineLayerStyles({
  ai: {
    value: {
      background: "linear-gradient(93.34deg, #e39cb0, #b690f4)",
    },
  },
  primary: {
    value: {
      background: "linear-gradient(60deg, #733DFF, #7DC1FF, #E59CFF, #BA9CFF, #9CB2FF)",
    },
  },
  secondary: {
    value: {
      background:
        "linear-gradient(90deg, rgba(115, 61, 255, 0.3) 0%, rgb(156, 178, 255, 0.3) 25%, rgb(229, 156, 255, 0.3) 50%, rgb(186, 156, 255, 0.3) 75%, rgba(133, 175, 242, 0.3) 100%) border-box border-box",
    },
  },
  subtlePrimary: {
    value: {
      background:
        "linear-gradient(93.34deg, rgba(115,61,255, 0.25) 30.09%, rgba(125,193,255, 0.25) 63.89%)",
    },
  },
})
