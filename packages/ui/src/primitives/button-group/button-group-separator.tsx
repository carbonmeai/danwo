import type { JsxStyleProps } from "@danwo/ui/types"

import { Separator, type SeparatorProps } from "../separator"

export type ButtonGroupSeparatorProps = SeparatorProps & JsxStyleProps

export const ButtonGroupSeparator = ({
  orientation = "vertical",
  decorative = true,
  ...props
}: ButtonGroupSeparatorProps) => {
  return (
    <Separator
      alignSelf="stretch"
      data-slot="button-group-separator"
      decorative={decorative}
      orientation={orientation}
      {...props}
    />
  )
}
