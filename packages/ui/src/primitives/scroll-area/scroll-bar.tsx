import { css, cx } from "@danwo/ui/css"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

export const ScrollBar = ({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) => {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      className={cx(
        css({
          display: "flex",
          touchAction: "none",
          transition: "background 160ms ease-out",
          userSelect: "none",
        }),
        orientation === "vertical" &&
          css({
            w: "4px",
          }),
        orientation === "horizontal" && css({ flexDir: "column", h: "4px" }),
        className,
      )}
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        className={css({
          "&:before": {
            content: '""',
            height: "100%",
            left: "50%",
            minHeight: 44,
            minWidth: 44,
            position: "absolute",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: "100%",
          },
          bg: "background.muted",
          flex: "1",
          pos: "relative",
          rounded: "full",
        })}
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}
