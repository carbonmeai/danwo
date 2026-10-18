import { cva } from "@danwo/ui/css"
import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Slot } from "radix-ui"
import type * as React from "react"

const breadcrumbLinkStyles = cva({
  base: {
    _hover: {
      color: "text.app",
    },
    transitionDuration: "150ms",
    transitionProperty: "color",
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
})

const StyledAnchor = styled("a", breadcrumbLinkStyles)

export type BreadcrumbLinkProps = React.ComponentProps<"a"> &
  JsxStyleProps & {
    asChild?: boolean
  }

export const BreadcrumbLink = ({ asChild, ...props }: BreadcrumbLinkProps) => {
  const Comp = asChild ? Slot.Root : StyledAnchor

  return <Comp data-slot="breadcrumb-link" {...props} />
}
