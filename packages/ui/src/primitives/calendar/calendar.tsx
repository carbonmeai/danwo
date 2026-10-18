import { css, cx } from "@danwo/ui/css"
import type { JsxStyleProps } from "@danwo/ui/types"
import * as React from "react"
import { type DayButtonProps, DayPicker, getDefaultClassNames } from "react-day-picker"

import { Icons } from "../../icons/base"
import { buttonStyle } from "../button/button-styles"

// Types
export type CalendarProps = React.ComponentProps<typeof DayPicker> &
  JsxStyleProps & {
    buttonVariant?: "ghost" | "transparent"
  }

// CalendarChevron Component
type ChevronProps = {
  orientation?: "left" | "right" | "up" | "down"
  className?: string
}

function CalendarChevron({ className, orientation, ...props }: ChevronProps) {
  const iconClassName = cx(css({ h: "4", w: "4" }), className)

  if (orientation === "left") {
    return <Icons.caretLeft className={iconClassName} {...props} />
  }

  if (orientation === "right") {
    return <Icons.caretRight className={iconClassName} {...props} />
  }

  return <Icons.caretDown className={iconClassName} {...props} />
}

// CalendarDayButton Component
export type CalendarDayButtonProps = DayButtonProps

export function CalendarDayButton({ className, day, modifiers, ...props }: CalendarDayButtonProps) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  const dayButtonClassName = cx(
    buttonStyle({ size: "icon", variant: "ghost" }),
    css({
      _dark: {
        _hover: {
          color: "text.app",
        },
      },

      "& > span": {
        fontSize: "1",
        opacity: "0.7",
      },
      "&[data-range-end=true]": {
        bg: "brand.primary.9",
        color: { base: "white", _dark: "background.app" },
        rounded: "var(--cell-radius)",
        roundedRight: "var(--cell-radius)",
      },
      "&[data-range-middle=true]": {
        bg: "background.muted",
        color: "text.app",
        rounded: "none",
      },
      "&[data-range-start=true]": {
        bg: "brand.primary.9",
        color: { base: "white", _dark: "background.app" },
        rounded: "var(--cell-radius)",
        roundedLeft: "var(--cell-radius)",
      },
      "&[data-selected-single=true]": {
        bg: "brand.primary.9",
        color: { base: "white", _dark: "background.app" },
      },
      aspectRatio: "square",
      border: "0",
      display: "flex",
      flexDir: "column",
      fontWeight: "normal",
      gap: "1",

      // h: 'auto',
      isolation: "isolate",
      lineHeight: "none",
      minW: "var(--cell-size)",
      position: "relative",
      w: "full",
      zIndex: "10",
    }),
    defaultClassNames.day,
    className,
  )

  return (
    <button
      className={dayButtonClassName}
      data-day={day.isoDate}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      data-range-start={modifiers.range_start}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      ref={ref}
      type="button"
      {...props}
    />
  )
}

// Main Calendar Component
export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: CalendarProps) {
  const defaultClassNames = getDefaultClassNames()

  // Root className
  const _rootClassName = cx(css({ w: "fit-content" }), defaultClassNames.root, classNames?.root)

  // Months container
  const _monthsClassName = cx(
    css({
      display: "flex",
      flexDir: { base: "column", md: "row" },
      gap: "4",
      position: "relative",
    }),
    defaultClassNames.months,
    classNames?.months,
  )

  // Single month
  const _monthClassName = cx(
    css({
      display: "flex",
      flexDir: "column",
      gap: "4",
      w: "full",
    }),
    defaultClassNames.month,
    classNames?.month,
  )

  // Navigation container
  const _navClassName = cx(
    css({
      alignItems: "center",
      display: "flex",
      gap: "1",
      insetX: "0",
      justifyContent: "space-between",
      position: "absolute",
      top: "0",
      w: "full",
    }),
    defaultClassNames.nav,
    classNames?.nav,
  )

  // Previous button
  const _buttonPreviousClassName = cx(
    buttonStyle({ size: "icon", variant: buttonVariant }),
    css({
      _disabled: { opacity: "0.5" },
      h: "var(--cell-size)",
      p: "0",
      userSelect: "none",
      w: "var(--cell-size)",
    }),
    defaultClassNames.button_previous,
    classNames?.button_previous,
  )

  // Next button
  const _buttonNextClassName = cx(
    buttonStyle({ size: "icon", variant: buttonVariant }),
    css({
      _disabled: { opacity: "0.5" },
      h: "var(--cell-size)",
      p: "0",
      userSelect: "none",
      w: "var(--cell-size)",
    }),
    defaultClassNames.button_next,
    classNames?.button_next,
  )

  // Month caption
  const _monthCaptionClassName = cx(
    css({
      alignItems: "center",
      display: "flex",
      h: "var(--cell-size)",
      justifyContent: "center",
      px: "var(--cell-size)",
      w: "full",
    }),
    defaultClassNames.month_caption,
    classNames?.month_caption,
  )

  // Dropdowns container
  const _dropdownsClassName = cx(
    css({
      alignItems: "center",
      display: "flex",
      fontSize: "2",
      fontWeight: "500",
      gap: "1.5",
      h: "var(--cell-size)",
      justifyContent: "center",
      w: "full",
    }),
    defaultClassNames.dropdowns,
    classNames?.dropdowns,
  )

  // Dropdown root
  const _dropdownRootClassName = cx(
    css({
      position: "relative",
      rounded: "var(--cell-radius)",
    }),
    defaultClassNames.dropdown_root,
    classNames?.dropdown_root,
  )

  // Dropdown select
  const _dropdownClassName = cx(
    css({
      bg: "background.popover",
      inset: "0",
      opacity: "0",
      position: "absolute",
    }),
    defaultClassNames.dropdown,
    classNames?.dropdown,
  )

  // Caption label
  const _captionLabelClassName = cx(
    css({
      "& > svg": {
        color: "text.muted",
        h: "3.5",
        w: "3.5",
      },
      alignItems: "center",
      display: captionLayout === "label" ? "block" : "flex",
      fontSize: "2",
      fontWeight: "500",
      gap: "1",
      rounded: "var(--cell-radius)",
      userSelect: "none",
    }),
    defaultClassNames.caption_label,
    classNames?.caption_label,
  )

  // Weekdays row
  const _weekdaysClassName = cx(
    css({ display: "flex" }),
    defaultClassNames.weekdays,
    classNames?.weekdays,
  )

  // Single weekday
  const _weekdayClassName = cx(
    css({
      color: "text.muted",
      flex: "1",
      fontSize: "1",
      fontWeight: "normal",
      rounded: "var(--cell-radius)",
      userSelect: "none",
    }),
    defaultClassNames.weekday,
    classNames?.weekday,
  )

  // Week row
  const _weekClassName = cx(
    css({
      display: "flex",
      mt: "2",
      w: "full",
    }),
    defaultClassNames.week,
    classNames?.week,
  )

  // Week number header
  const _weekNumberHeaderClassName = cx(
    css({
      userSelect: "none",
      w: "var(--cell-size)",
    }),
    defaultClassNames.week_number_header,
    classNames?.week_number_header,
  )

  // Week number
  const _weekNumberClassName = cx(
    css({
      color: "text.muted",
      fontSize: "1",
      userSelect: "none",
    }),
    defaultClassNames.week_number,
    classNames?.week_number,
  )

  // Month grid (table)
  const _monthGridClassName = cx(
    css({
      borderCollapse: "collapse",
      w: "full",
    }),
    defaultClassNames.month_grid,
    classNames?.month_grid,
  )

  // Day cell
  const _dayClassName = cx(
    css({
      "&:first-child[data-selected=true] button": {
        roundedLeft: "var(--cell-radius)",
      },
      "&:last-child[data-selected=true] button": {
        roundedRight: "var(--cell-radius)",
      },
      aspectRatio: "square",
      h: "full",
      p: "0",
      position: "relative",
      rounded: "var(--cell-radius)",
      textAlign: "center",
      userSelect: "none",
      w: "full",
    }),
    props.showWeekNumber
      ? css({
          "&:nth-child(2)[data-selected=true] button": {
            roundedLeft: "var(--cell-radius)",
          },
        })
      : css({
          "&:first-child[data-selected=true] button": {
            roundedLeft: "var(--cell-radius)",
          },
        }),
    defaultClassNames.day,
    classNames?.day,
  )

  // Range start
  const _rangeStartClassName = cx(
    css({
      _after: {
        bg: "background.muted",
        content: '""',
        insetY: "0",
        position: "absolute",
        right: "0",
        w: "4",
      },
      bg: "background.muted",
      isolation: "isolate",
      position: "relative",
      roundedLeft: "var(--cell-radius)",
      zIndex: "0",
    }),
    defaultClassNames.range_start,
    classNames?.range_start,
  )

  // Range middle
  const _rangeMiddleClassName = cx(
    css({ rounded: "none" }),
    defaultClassNames.range_middle,
    classNames?.range_middle,
  )

  // Range end
  const _rangeEndClassName = cx(
    css({
      _after: {
        bg: "background.muted",
        content: '""',
        insetY: "0",
        left: "0",
        position: "absolute",
        w: "4",
      },
      bg: "background.muted",
      isolation: "isolate",
      position: "relative",
      roundedRight: "var(--cell-radius)",
      zIndex: "0",
    }),
    defaultClassNames.range_end,
    classNames?.range_end,
  )

  // Today
  const _todayClassName = cx(
    css({
      "&[data-selected=true]": { rounded: "none" },
      bg: "background.muted",
      color: "text.app",
      rounded: "var(--cell-radius)",
    }),
    defaultClassNames.today,
    classNames?.today,
  )

  // Outside days
  const _outsideClassName = cx(
    css({
      _selected: { color: "text.muted" },
      color: "text.muted",
    }),
    defaultClassNames.outside,
    classNames?.outside,
  )

  // Disabled days
  const _disabledClassName = cx(
    css({
      color: "text.muted",
      opacity: "0.5",
    }),
    defaultClassNames.disabled,
    classNames?.disabled,
  )

  // Hidden days
  const _hiddenClassName = cx(
    css({ visibility: "hidden" }),
    defaultClassNames.hidden,
    classNames?.hidden,
  )

  // Selected day
  const _selectedClassName = cx(defaultClassNames.selected, classNames?.selected)

  return (
    <DayPicker
      captionLayout={captionLayout}
      className={cx(
        css({
          "--cell-radius": "radii.md",
          "--cell-size": "spacing.7",
          bg: "background.popover",
          p: "2",
        }),
        className,
      )}
      classNames={{
        button_next: _buttonNextClassName,
        button_previous: _buttonPreviousClassName,
        caption_label: _captionLabelClassName,
        day: _dayClassName,
        disabled: _disabledClassName,
        dropdown: _dropdownClassName,
        dropdown_root: _dropdownRootClassName,
        dropdowns: _dropdownsClassName,
        hidden: _hiddenClassName,
        month: _monthClassName,
        month_caption: _monthCaptionClassName,
        month_grid: _monthGridClassName,
        months: _monthsClassName,
        nav: _navClassName,
        outside: _outsideClassName,
        range_end: _rangeEndClassName,
        range_middle: _rangeMiddleClassName,
        range_start: _rangeStartClassName,
        root: _rootClassName,
        selected: _selectedClassName,
        today: _todayClassName,
        week: _weekClassName,
        week_number: _weekNumberClassName,
        week_number_header: _weekNumberHeaderClassName,
        weekday: _weekdayClassName,
        weekdays: _weekdaysClassName,
        ...classNames,
      }}
      components={{
        Chevron: CalendarChevron,
        DayButton: CalendarDayButton,
        Root: ({ className: rootClassName, rootRef, ...rootProps }) => {
          return (
            <div className={cx(rootClassName)} data-slot="calendar" ref={rootRef} {...rootProps} />
          )
        },
        WeekNumber: ({ children, ...weekNumberProps }) => {
          return (
            <td {...weekNumberProps}>
              <div
                className={css({
                  alignItems: "center",
                  display: "flex",
                  h: "var(--cell-size)",
                  justifyContent: "center",
                  textAlign: "center",
                  w: "var(--cell-size)",
                })}
              >
                {children}
              </div>
            </td>
          )
        },
        ...components,
      }}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      showOutsideDays={showOutsideDays}
      {...props}
    />
  )
}
