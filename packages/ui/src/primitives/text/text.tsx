import { styled } from "@danwo/ui/jsx"
import type { JsxStyleProps } from "@danwo/ui/types"
import { Slot } from "@radix-ui/react-slot"
import * as React from "react"

type Props<T> = {
  asChild?: boolean
  children?: React.ReactNode
} & React.HTMLAttributes<T> &
  JsxStyleProps

export type TextProps = Props<HTMLParagraphElement> & {
  maxLines?: number
}
export type SpanProps = Props<HTMLSpanElement> & React.ComponentProps<"span">
export type PreProps = Props<HTMLPreElement> & React.ComponentProps<"pre">
export type CodeProps = Props<HTMLElement> & React.ComponentProps<"code">
export type KbdProps = Props<HTMLElement> & React.ComponentProps<"kbd">

export type HeadingProps = Props<HTMLHeadingElement> & {
  as: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
}

export const Heading = ({ asChild, as, ...props }: HeadingProps) => {
  const Comp = asChild ? Slot : styled[as]

  return <Comp {...props} />
}

export const Text = ({ asChild, style, maxLines, ...props }: TextProps) => {
  const Comp = asChild ? Slot : styled.p

  return (
    <Comp
      {...props}
      style={{
        ...style,
        ...(maxLines
          ? {
              display: "-webkit-box",
              overflow: "hidden",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: maxLines,
            }
          : {}),
      }}
    />
  )
}

export const Span = ({ asChild, ...props }: SpanProps) => {
  const Comp = asChild ? Slot : styled.span

  return <Comp {...props} />
}

export const Pre = ({ asChild, ...props }: PreProps) => {
  const Comp = asChild ? Slot : styled.pre

  return <Comp {...props} />
}

export const Code = ({ asChild, ...props }: CodeProps) => {
  const Comp = asChild ? Slot : styled.code

  return <Comp {...props} />
}

export const Kbd = ({ asChild, ...props }: KbdProps) => {
  const Comp = asChild ? Slot : styled.kbd

  return <Comp {...props} />
}
