import { css } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import * as React from "react"

import { Skeleton } from "../skeleton"

type SidebarMenuSkeletonProps = React.ComponentProps<"div"> &
  JsxStyleProps & {
    showIcon?: boolean
  }

const skeletonWrapperStyles = css({
  alignItems: "center",
  display: "flex",
  gap: "2",
  h: "8",
  px: "2",
  rounded: "md",
})

export const SidebarMenuSkeleton = ({ showIcon = false, ...props }: SidebarMenuSkeletonProps) => {
  const width = React.useMemo(() => {
    return `${Math.floor(Math.random() * 40) + 50}%`
  }, [])

  return (
    <div className={skeletonWrapperStyles} data-slot="sidebar-menu-skeleton" {...props}>
      {showIcon && (
        <Skeleton css={{ h: "4", rounded: "md", w: "4" }} data-slot="sidebar-menu-skeleton-icon" />
      )}
      <Skeleton
        css={{ flex: "1", h: "4" }}
        data-slot="sidebar-menu-skeleton-text"
        style={{ maxWidth: width, width }}
      />
    </div>
  )
}
