import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

import { Icons } from "../../icons"
import { VisuallyHidden } from "../visually-hidden"

const breadcrumbEllipsisStyles = cva({
  base: {
    "& svg": {
      h: "4",
      w: "4",
    },
    alignItems: "center",
    display: "flex",
    h: "9",
    justifyContent: "center",
    w: "9",
  },
})

const StyledSpan = styled("span", breadcrumbEllipsisStyles)

export type BreadcrumbEllipsisProps = React.ComponentProps<"span"> & JsxStyleProps

export const BreadcrumbEllipsis = ({ ...props }: BreadcrumbEllipsisProps) => {
  return (
    <StyledSpan aria-hidden="true" data-slot="breadcrumb-ellipsis" role="presentation" {...props}>
      <Icons.ellipsis />
      <VisuallyHidden>More</VisuallyHidden>
    </StyledSpan>
  )
}
