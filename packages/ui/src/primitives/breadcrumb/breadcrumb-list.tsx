import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const breadcrumbListStyles = cva({
  base: {
    alignItems: "center",
    color: "text.muted",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "2",
    gap: "1.5",
    sm: {
      gap: "2.5",
    },
    wordBreak: "break-word",
  },
})

const StyledOl = styled("ol", breadcrumbListStyles)

export type BreadcrumbListProps = React.ComponentProps<"ol"> & JsxStyleProps

export const BreadcrumbList = ({ ...props }: BreadcrumbListProps) => {
  return <StyledOl data-slot="breadcrumb-list" {...props} />
}
