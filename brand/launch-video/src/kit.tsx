import type { CSSProperties, ReactNode } from "react"
import { Audio, Easing, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion"

import { C, MONO, SANS } from "./theme.ts"

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

/** 0 → 1 over `duration` frames from `start`, eased out. */
export function ease(frame: number, start: number, duration: number): number {
  return interpolate(frame, [start, start + duration], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  })
}

/** The dark stage every scene stands on: a dotted grid fading out from the centre and a slow glow. */
export function Backdrop({ glow = 0.07 }: { readonly glow?: number }) {
  const frame = useCurrentFrame()
  const x = 50 + Math.sin(frame / 90) * 12
  const y = 42 + Math.cos(frame / 110) * 8

  return (
    <div style={{ position: "absolute", inset: 0, background: C.bg, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(rgb(255 255 255 / 0.11) 1.2px, transparent 1.2px)",
          backgroundSize: "36px 36px",
          backgroundPosition: `0 ${-frame * 0.25}px`,
          maskImage: "radial-gradient(ellipse 60% 55% at 50% 50%, #000 0%, transparent 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 45% 40% at ${x}% ${y}%, rgb(255 255 255 / ${glow}), transparent 70%)`,
        }}
      />
    </div>
  )
}

/** Chinese characters and the punctuation set with them, which takes no space between words. */
const CJK = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/

/** The gap after `word`: none between two runs of Chinese, a space's width otherwise. */
function gapAfter(word: string, next: string | undefined): string {
  return next !== undefined && CJK.test(word.at(-1) ?? "") && CJK.test(next.at(0) ?? "")
    ? "0"
    : "0.24em"
}

interface WordsProps {
  readonly text: string
  readonly start?: number
  readonly stagger?: number
  readonly size?: number
  readonly weight?: number
  readonly color?: string
  /** Words drawn in the muted colour. */
  readonly dim?: readonly string[]
  readonly style?: CSSProperties
}

/**
 * A line that arrives a word at a time, each one rising out of a blur. Chinese is split into
 * phrases by spaces too, drawn without the gap and without the tight tracking Latin text takes.
 */
export function Words({
  text,
  start = 0,
  stagger = 3,
  size = 96,
  weight = 600,
  color = C.text,
  dim = [],
  style,
}: WordsProps) {
  const frame = useCurrentFrame()

  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: size,
        fontWeight: weight,
        letterSpacing: "-0.045em",
        lineHeight: 1.08,
        color,
        whiteSpace: "pre-wrap",
        ...style,
      }}
    >
      {text.split(" ").map((word, i, words) => {
        const p = ease(frame, start + i * stagger, 22)

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: p,
              transform: `translateY(${(1 - p) * 0.35}em)`,
              filter: `blur(${(1 - p) * 14}px)`,
              color: dim.includes(word) ? C.muted : undefined,
              marginRight: gapAfter(word, words[i + 1]),
              letterSpacing: CJK.test(word) ? "0" : undefined,
            }}
          >
            {word}
          </span>
        )
      })}
    </div>
  )
}

/** Fades and blurs its children out over `duration` frames from `at`. */
export function Exit({
  at,
  duration = 12,
  children,
  lift = 0,
}: {
  readonly at: number
  readonly duration?: number
  readonly children: ReactNode
  readonly lift?: number
}) {
  const frame = useCurrentFrame()
  const p = interpolate(frame, [at, at + duration], [0, 1], {
    ...clamp,
    easing: (t) => t ** 3,
  })

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: 1 - p,
        filter: `blur(${p * 16}px)`,
        transform: `translateY(${-p * lift}px) scale(${1 - p * 0.04})`,
      }}
    >
      {children}
    </div>
  )
}

/** A rounded, raised panel in the dashboard's style. */
export function Card({
  children,
  style,
}: {
  readonly children: ReactNode
  readonly style?: CSSProperties
}) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 20,
        boxShadow: "0 40px 80px rgb(0 0 0 / 0.6), inset 0 1px 0 rgb(255 255 255 / 0.05)",
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** A small rounded label, like the dashboard's badges. */
export function Chip({
  children,
  style,
}: {
  readonly children: ReactNode
  readonly style?: CSSProperties
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 20px",
        borderRadius: 999,
        background: C.raised,
        border: `1px solid ${C.line}`,
        fontFamily: SANS,
        fontSize: 26,
        fontWeight: 500,
        color: C.text,
        letterSpacing: "-0.01em",
        boxShadow: "0 16px 40px rgb(0 0 0 / 0.5)",
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** The pointer, drawn the way macOS draws it. */
export function Cursor({
  x,
  y,
  press = 0,
}: {
  readonly x: number
  readonly y: number
  readonly press?: number
}) {
  return (
    <svg
      width={40}
      height={40}
      viewBox="0 0 24 24"
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `scale(${1 - press * 0.18})`,
        transformOrigin: "4px 3px",
        filter: "drop-shadow(0 6px 10px rgb(0 0 0 / 0.5))",
      }}
    >
      <path
        d="M4 3 L4 19 L8.4 14.9 L11.3 21.2 L14 20 L11.2 13.8 L17.3 13.6 Z"
        fill="#fff"
        stroke="#000"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Text in Geist Mono. */
export function Mono({
  children,
  size = 26,
  color = C.text,
  style,
}: {
  readonly children: ReactNode
  readonly size?: number
  readonly color?: string
  readonly style?: CSSProperties
}) {
  return (
    <span style={{ fontFamily: MONO, fontSize: size, color, letterSpacing: "-0.01em", ...style }}>
      {children}
    </span>
  )
}

/** The first `count` characters of `text`, typed at `perFrame` characters a frame from `start`. */
export function typed(text: string, frame: number, start: number, perFrame = 0.9): string {
  return text.slice(0, Math.max(0, Math.floor((frame - start) * perFrame)))
}

/** Plays one of the generated sound effects at frame `at`. */
export function Sfx({
  name,
  at,
  volume = 0.5,
}: {
  readonly name: string
  readonly at: number
  readonly volume?: number
}) {
  return (
    <Sequence from={Math.round(at)} durationInFrames={90} layout="none">
      <Audio src={staticFile(`audio/${name}.mp3`)} volume={volume} />
    </Sequence>
  )
}
