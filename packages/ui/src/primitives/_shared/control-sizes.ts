/**
 * One height scale for every control, so a button, input and select line up in
 * a toolbar without per-component nudging. 16px root — see docs/plans/10.
 */
export const controlSizes = {
  xxs: { h: "1.75rem", px: "2", fontSize: "xs", rounded: "lg" }, // 28px — toolbar, chips
  xs: { h: "2rem", px: "2.5", fontSize: "xs", rounded: "lg" }, // 32px — grid controls
  sm: { h: "2.25rem", px: "3", fontSize: "sm", rounded: "lg" }, // 36px — forms
  md: { h: "2.5rem", px: "4", fontSize: "sm", rounded: "lg" }, // 40px — primary CTA
  /** square: an icon-only control must not be wider than it is tall */
  icon: { h: "2rem", w: "2rem", px: "0", fontSize: "sm", rounded: "lg" },
} as const

export type ControlSize = keyof typeof controlSizes
