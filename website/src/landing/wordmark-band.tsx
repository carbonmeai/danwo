/**
 * The wordmark band at the top of the footer: the dánwò wordmark across the page, dim until a
 * pointer lights the letters under it, and cut by a horizon line that glows beneath.
 */
import { type RefObject, useEffect, useRef } from "react"

import wordmarkSvg from "../../../brand/svg/danwo-wordmark-white.svg?raw"
import {
  approach,
  type Point,
  restingPoint,
  sweepPoint,
  toWordmark,
  wordmarkShape,
} from "./wordmark-light.ts"

const SHAPE = wordmarkShape(wordmarkSvg)

/** How much of the wordmark's own height shows above the horizon. */
const ABOVE_HORIZON = 0.7

/**
 * Room drawn above the wordmark's view box: the brand file's box sits a little below the top of
 * the d, and the band must show the whole letter.
 */
const HEADROOM = SHAPE.height * 0.08

/** The box the band draws: the wordmark's, raised by the headroom and cut at the horizon. */
const BOX = {
  x: SHAPE.x,
  y: SHAPE.y - HEADROOM,
  width: SHAPE.width,
  height: SHAPE.height + HEADROOM,
  shown: SHAPE.height * ABOVE_HORIZON + HEADROOM,
}

/** The light's reach: the edge light covers about one letter, the glow a little more. */
const EDGE_REACH = SHAPE.width * 0.125
const GLOW_REACH = SHAPE.width * 0.165

/** A region every filter and mask uses, wide enough that none of them crops a letter. */
const REGION = {
  x: BOX.x - BOX.width * 0.25,
  y: BOX.y - BOX.height,
  width: BOX.width * 1.5,
  height: BOX.height * 3,
}

/** How fast the light follows the pointer, and how fast it brightens or fades, in milliseconds. */
const FOLLOW_TAU = 90
const FADE_TAU = 240

/** How bright the light that moves on its own is, and the one that rests for reduced motion. */
const SWEEP_LIGHT = 0.7
const RESTING_LIGHT = 0.55

/** The parts of the band the light writes to. */
interface LightParts {
  readonly band: RefObject<HTMLDivElement | null>
  readonly svg: RefObject<SVGSVGElement | null>
  readonly spots: readonly RefObject<SVGRadialGradientElement | null>[]
  readonly lit: RefObject<SVGGElement | null>
  readonly under: RefObject<HTMLDivElement | null>
}

/** Moves the light to `point` at brightness `light`: the spotlight, the letters and the horizon glow. */
function place(parts: LightParts, point: Point, light: number): void {
  for (const spot of parts.spots) {
    spot.current?.setAttribute("cx", point.x.toFixed(1))
    spot.current?.setAttribute("cy", point.y.toFixed(1))
  }

  parts.lit.current?.style.setProperty("opacity", light.toFixed(3))
  parts.under.current?.style.setProperty(
    "--gx",
    `${(((point.x - SHAPE.x) / SHAPE.width) * 100).toFixed(1)}%`,
  )
  parts.under.current?.style.setProperty("--gi", light.toFixed(3))
}

/**
 * Drives the light: it follows a pointer over the footer and fades when the pointer leaves; on a
 * screen with no hover it sweeps across the letters by itself; for reduced motion it rests, still.
 * Nothing runs while the band is off screen.
 */
function useWordmarkLight(parts: LightParts): void {
  useEffect(() => {
    const band = parts.band.current
    const svg = parts.svg.current

    if (!band || !svg) return undefined

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      place(parts, restingPoint(SHAPE), RESTING_LIGHT)

      return undefined
    }

    const sweeping = window.matchMedia("(hover: none)").matches
    const footer = band.closest("footer") ?? band
    const current = { ...restingPoint(SHAPE), light: 0 }
    let pointer: Point | undefined
    let inside = false
    let visible = false
    let frame = 0
    let last = 0

    /** Where the light is heading and how bright it should end up. */
    const target = (now: number): Point & { light: number } => {
      if (sweeping) return { ...sweepPoint(now, SHAPE), light: SWEEP_LIGHT }
      if (!pointer) return { x: current.x, y: current.y, light: 0 }

      return { ...toWordmark(pointer, svg.getBoundingClientRect(), SHAPE), light: inside ? 1 : 0 }
    }

    const tick = (now: number) => {
      const ms = last === 0 ? 16 : now - last
      const goal = target(now)

      frame = 0
      last = now
      current.x = approach(current.x, goal.x, ms, FOLLOW_TAU)
      current.y = approach(current.y, goal.y, ms, FOLLOW_TAU)
      current.light = approach(current.light, goal.light, ms, FADE_TAU)
      place(parts, current, current.light)

      const settled =
        !sweeping &&
        Math.abs(current.light - goal.light) < 0.004 &&
        Math.hypot(current.x - goal.x, current.y - goal.y) < 0.5

      if (visible && !settled) frame = requestAnimationFrame(tick)
      else last = 0
    }

    const wake = () => {
      if (visible && frame === 0) frame = requestAnimationFrame(tick)
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false

      if (visible) wake()
      else if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
        last = 0
      }
    })

    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" && event.pointerType !== "pen") return

      pointer = { x: event.clientX, y: event.clientY }
      inside = true
      wake()
    }

    const leave = () => {
      inside = false
      wake()
    }

    observer.observe(band)
    footer.addEventListener("pointermove", move)
    footer.addEventListener("pointerleave", leave)

    return () => {
      observer.disconnect()
      footer.removeEventListener("pointermove", move)
      footer.removeEventListener("pointerleave", leave)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [parts])
}

/** A spotlight centred on the resting point, `reach` wide, falling off steeply to nothing. */
function Spot({
  id,
  reach,
  spot,
}: {
  readonly id: string
  readonly reach: number
  readonly spot: RefObject<SVGRadialGradientElement | null>
}) {
  const resting = restingPoint(SHAPE)

  return (
    <radialGradient
      ref={spot}
      id={id}
      gradientUnits="userSpaceOnUse"
      cx={resting.x}
      cy={resting.y}
      r={reach}
    >
      <stop offset="0" stopColor="#fff" />
      <stop offset="0.35" stopColor="#fff" stopOpacity="0.8" />
      <stop offset="0.7" stopColor="#fff" stopOpacity="0.22" />
      <stop offset="1" stopColor="#fff" stopOpacity="0" />
    </radialGradient>
  )
}

/** A mask that shows what is under the spotlight `spot`. */
function SpotMask({ id, spot }: { readonly id: string; readonly spot: string }) {
  return (
    <mask id={id} maskUnits="userSpaceOnUse" {...REGION}>
      <rect {...REGION} fill={`url(#${spot})`} />
    </mask>
  )
}

/**
 * The wordmark band: letters barely above the black, and, under the spotlight, a hairline outline
 * with a tight glow beside it and a faint lift inside the lit letter; the horizon cuts them.
 */
export function WordmarkBand() {
  const band = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const edge = useRef<SVGRadialGradientElement>(null)
  const glow = useRef<SVGRadialGradientElement>(null)
  const lit = useRef<SVGGElement>(null)
  const under = useRef<HTMLDivElement>(null)
  const parts = useRef<LightParts>({ band, svg, spots: [edge, glow], lit, under })
  const { d } = SHAPE

  useWordmarkLight(parts.current)

  return (
    <div className="wm" ref={band} aria-hidden="true">
      <div className="wrap">
        <div className="wm-clip" style={{ aspectRatio: `${BOX.width} / ${BOX.shown}` }}>
          <svg
            ref={svg}
            className="wm-svg"
            viewBox={`${BOX.x} ${BOX.y} ${BOX.width} ${BOX.height}`}
            focusable="false"
          >
            <defs>
              <Spot id="danwo-wm-edge" reach={EDGE_REACH} spot={edge} />
              <Spot id="danwo-wm-glow" reach={GLOW_REACH} spot={glow} />
              <SpotMask id="danwo-wm-edge-mask" spot="danwo-wm-edge" />
              <SpotMask id="danwo-wm-glow-mask" spot="danwo-wm-glow" />
              <filter id="danwo-wm-blur" filterUnits="userSpaceOnUse" {...REGION}>
                <feGaussianBlur stdDeviation={SHAPE.width * 0.0024} />
              </filter>
              <filter id="danwo-wm-haze" filterUnits="userSpaceOnUse" {...REGION}>
                <feGaussianBlur stdDeviation={SHAPE.width * 0.012} />
              </filter>
            </defs>
            <path className="wm-dim" d={d} />
            <g ref={lit} style={{ opacity: 0 }}>
              <g mask="url(#danwo-wm-glow-mask)">
                <path className="wm-haze" d={d} filter="url(#danwo-wm-haze)" />
                <path className="wm-glow" d={d} filter="url(#danwo-wm-blur)" />
              </g>
              <g mask="url(#danwo-wm-edge-mask)">
                <path className="wm-lift" d={d} />
                <path className="wm-line" d={d} />
              </g>
            </g>
          </svg>
        </div>
      </div>
      <div className="wm-under" ref={under} />
    </div>
  )
}
