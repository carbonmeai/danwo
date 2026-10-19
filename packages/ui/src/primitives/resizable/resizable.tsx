import { css, cx } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import * as ResizablePrimitive from "react-resizable-panels"

import { Icons } from "../../icons/base"
import { Center } from "../layout"

const groupStyles = css({
  "&[data-panel-group-direction=vertical]": {
    flexDir: "column",
  },
  display: "flex",
  h: "100%",
  w: "100%",
})

const ResizablePanelGroup = ({
  className,
  direction,
  autoSaveId,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group> &
  JsxStyleProps & {
    direction?: "horizontal" | "vertical"
    autoSaveId?: string
  }) => (
  <ResizablePrimitive.Group
    className={cx(groupStyles, className)}
    id={autoSaveId ?? props.id}
    orientation={direction ?? props.orientation}
    {...props}
  />
)

const ResizablePanel = ResizablePrimitive.Panel

const handleStyles = css({
  "&:after": {
    insetY: "0",
    left: "50%",
    pos: "absolute",
    transform: "translateX(50%)",
    w: "4px",
  },

  "&:focus-visible": {
    border: "focused",
    outline: "none",
  },

  /**
   * The separator between stacked panels: react-resizable-panels 4 marks it with
   * `aria-orientation="horizontal"` rather than the older group-direction attribute.
   */
  "&[data-panel-group-direction=vertical], &[aria-orientation=horizontal]": {
    "&:after": {
      h: "4px",
      left: 0,
      transform: "translate(0, 50%)",
      w: "100%",
    },
    h: "1px",
    w: "100%",
  },

  "&[data-panel-group-direction=vertical] > div": {
    // transform: 'rotate(90deg)'
  },
  alignItems: "center",
  bg: "background.muted",
  display: "flex",
  justifyContent: "center",
  pos: "relative",
  w: "1px",
})

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean
} & JsxStyleProps) => (
  <ResizablePrimitive.Separator className={cx(handleStyles, className)} {...props}>
    {withHandle && (
      <Center border="subtle" overflow="hidden" px="1.5" rounded="md" zIndex="10">
        <Icons.gripHorizontal size={16} />
      </Center>
    )}
  </ResizablePrimitive.Separator>
)

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
