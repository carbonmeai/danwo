import { css } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"

import { Input, type InputProps } from "../input"

type SidebarInputProps = InputProps & JsxStyleProps

const inputWrapperStyles = css({
  px: "2",
})

export const SidebarInput = (props: SidebarInputProps) => {
  return (
    <div className={inputWrapperStyles}>
      <Input
        data-slot="sidebar-input"
        {...props}
        css={{
          _focusVisible: {
            ring: "2px",
            ringColor: "border.focused",
          },
          bg: "background.app",
          h: "8",
          shadow: "none",
        }}
      />
    </div>
  )
}
