import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const breadcrumbItemStyles = cva({
  base: {
    alignItems: "center",
    display: "inline-flex",
    gap: "1.5",
  },
})

const StyledLi = styled("li", breadcrumbItemStyles)

export type BreadcrumbItemProps = React.ComponentProps<"li"> & JsxStyleProps

export const BreadcrumbItem = ({ ...props }: BreadcrumbItemProps) => {
  return <StyledLi data-slot="breadcrumb-item" {...props} />
}
