import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import type * as React from "react"

export type BreadcrumbProps = React.ComponentProps<"nav"> & JsxStyleProps

const StyledNav = styled("nav")

export const Breadcrumb = ({ ...props }: BreadcrumbProps) => {
  return <StyledNav aria-label="breadcrumb" data-slot="breadcrumb" {...props} />
}
