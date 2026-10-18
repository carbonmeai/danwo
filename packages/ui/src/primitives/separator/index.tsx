import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Separator as SeparatorPrimitive } from "radix-ui"
import type * as React from "react"

export type SeparatorProps = React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> &
  JsxStyleProps & {
    orientation?: "horizontal" | "vertical"
    decorative?: boolean
  }

const separatorStyles = cva({
  base: {
    bg: "palette.gray.3",
    flexShrink: 0,
  },
})

const StyledSeparator = styled(SeparatorPrimitive.Root, separatorStyles)

export const Separator = ({
  orientation = "horizontal",
  decorative = true,
  ...props
}: SeparatorProps) => {
  return (
    <StyledSeparator
      decorative={decorative}
      orientation={orientation}
      {...props}
      style={{
        height: orientation === "horizontal" ? "1px" : "100%",
        width: orientation === "vertical" ? "1px" : "100%",
      }}
    />
  )
}
