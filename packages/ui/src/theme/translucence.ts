type GlassValue = "popup" | "tour" | "overlay" | "none"

export const glass = {
  className: "glass",
  transform(value: GlassValue) {
    let filter = "blur(10px) saturate(190%) contrast(70%) brightness(80%)"

    if (value === "popup") filter = "blur(50px)"

    if (value === "tour") filter = "blur(35px)"

    if (value === "overlay") filter = "blur(2px)"

    if (value === "none") filter = "none"

    return {
      backdropFilter: filter,
    }
  },
  values: ["popup", "tour", "overlay", "none"],
}
