import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

const breadcrumbPageStyles = cva({
  base: {
    color: "text.app",
    fontWeight: "400",
  },
})

const StyledSpan = styled("span", breadcrumbPageStyles)

export type BreadcrumbPageProps = React.ComponentProps<"span"> & JsxStyleProps

export const BreadcrumbPage = ({ ...props }: BreadcrumbPageProps) => {
  return (
    <StyledSpan
      aria-current="page"
      aria-disabled="true"
      data-slot="breadcrumb-page"
      role="link"
      {...props}
    />
  )
}
