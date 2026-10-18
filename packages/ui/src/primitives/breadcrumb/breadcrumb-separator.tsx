import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

import { Icons } from "../../icons"

const breadcrumbSeparatorStyles = cva({
  base: {
    "& svg": {
      h: "3.5",
      w: "3.5",
    },
  },
})

const StyledLi = styled("li", breadcrumbSeparatorStyles)

export type BreadcrumbSeparatorProps = React.ComponentProps<"li"> & JsxStyleProps

export const BreadcrumbSeparator = ({ children, ...props }: BreadcrumbSeparatorProps) => {
  return (
    <StyledLi aria-hidden="true" data-slot="breadcrumb-separator" role="presentation" {...props}>
      {children ?? <Icons.caretRight />}
    </StyledLi>
  )
}
