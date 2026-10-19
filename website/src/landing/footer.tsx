/**
 * The landing page's footer: the dánwò wordmark across the page, dim until a pointer lights the
 * letters under it, cut by a horizon line, and the site's links below.
 */
import { Link } from "@tanstack/react-router"
import { type ReactNode, type RefObject, useEffect, useRef } from "react"

import wordmarkSvg from "../../../brand/svg/danwo-wordmark-white.svg?raw"
import cliPackage from "../../../packages/cli/package.json"
import { Lockup } from "../components/brand.tsx"
import { licenceWords, repoUrl, SITE } from "../lib/site.ts"
import {
  approach,
  type Point,
  restingPoint,
  sweepPoint,
  toWordmark,
  wordmarkShape,
} from "./wordmark-light.ts"

const SHAPE = wordmarkShape(wordmarkSvg)

/** How much of the wordmark's height shows above the horizon. */
const ABOVE_HORIZON = 0.7

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
  readonly spot: RefObject<SVGRadialGradientElement | null>
  readonly lit: RefObject<SVGGElement | null>
  readonly under: RefObject<HTMLDivElement | null>
}

/** Moves the light to `point` at brightness `light`: the spotlight, the letters and the horizon glow. */
function place(parts: LightParts, point: Point, light: number): void {
  parts.spot.current?.setAttribute("cx", point.x.toFixed(1))
  parts.spot.current?.setAttribute("cy", point.y.toFixed(1))
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

/** The wordmark band: dim letters, the lit layers the spotlight reveals, and the horizon under them. */
function WordmarkBand() {
  const band = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const spot = useRef<SVGRadialGradientElement>(null)
  const lit = useRef<SVGGElement>(null)
  const under = useRef<HTMLDivElement>(null)
  const parts = useRef<LightParts>({ band, svg, spot, lit, under })
  const resting = restingPoint(SHAPE)
  const { x, y, width, height, d } = SHAPE

  useWordmarkLight(parts.current)

  return (
    <div className="wm" ref={band} aria-hidden="true">
      <div className="wrap">
        <div className="wm-clip" style={{ aspectRatio: `${width} / ${height * ABOVE_HORIZON}` }}>
          <svg
            ref={svg}
            className="wm-svg"
            viewBox={`${x} ${y} ${width} ${height}`}
            focusable="false"
          >
            <defs>
              <radialGradient
                ref={spot}
                id="danwo-wm-spot"
                gradientUnits="userSpaceOnUse"
                cx={resting.x}
                cy={resting.y}
                r={width * 0.17}
              >
                <stop offset="0" stopColor="#fff" />
                <stop offset="0.45" stopColor="#fff" stopOpacity="0.55" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
              <mask
                id="danwo-wm-mask"
                maskUnits="userSpaceOnUse"
                x={x - width}
                y={y - height}
                width={width * 3}
                height={height * 3}
              >
                <rect
                  x={x - width}
                  y={y - height}
                  width={width * 3}
                  height={height * 3}
                  fill="url(#danwo-wm-spot)"
                />
              </mask>
              <linearGradient id="danwo-wm-face" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity="0.13" />
                <stop offset="1" stopColor="#fff" stopOpacity="0.03" />
              </linearGradient>
              <filter id="danwo-wm-halo" x="-5%" y="-20%" width="110%" height="140%">
                <feGaussianBlur stdDeviation={width * 0.0035} />
              </filter>
            </defs>
            <path className="wm-dim" d={d} />
            <g ref={lit} mask="url(#danwo-wm-mask)" style={{ opacity: 0 }}>
              <path d={d} fill="url(#danwo-wm-face)" />
              <path
                d={d}
                fill="none"
                stroke="#fff"
                strokeWidth={width * 0.005}
                strokeOpacity="0.4"
                filter="url(#danwo-wm-halo)"
              />
              <path
                d={d}
                fill="none"
                stroke="#fff"
                strokeWidth="1.25"
                strokeOpacity="0.95"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </svg>
        </div>
      </div>
      <div className="wm-under" ref={under} />
    </div>
  )
}

/** A footer link: a route inside the site, or an address outside it. */
type FooterLink = readonly [text: string, href: string]

/** A footer column: its heading and links; a column with no links is left out. */
function Column({
  title,
  links,
}: {
  readonly title: string
  readonly links: readonly FooterLink[]
}) {
  if (links.length === 0) return null

  return (
    <div>
      <h4>{title}</h4>
      {links.map(([text, href]) => (
        <a key={text} href={href} {...(href.startsWith("http") && { rel: "noreferrer" })}>
          {text}
        </a>
      ))}
    </div>
  )
}

/** A round icon link to danwo somewhere else. */
function Social({
  href,
  label,
  children,
}: {
  readonly href: string
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <a className="social" href={href} aria-label={label} rel="noreferrer">
      {children}
    </a>
  )
}

/** The links that are set: an address, or nothing when it is not set yet. */
function present(...links: readonly (readonly [string, string | undefined])[]): FooterLink[] {
  return links.flatMap(([text, href]) => (href === undefined ? [] : [[text, href] as const]))
}

/** The released version, when there is one. */
function released(): string | undefined {
  return cliPackage.version === "0.0.0" ? undefined : `v${cliPackage.version}`
}

export function Footer() {
  const github = repoUrl()
  const version = released()

  return (
    <footer>
      <WordmarkBand />
      <div className="wrap">
        <div className="foot">
          <div className="foot-brand">
            <Link className="home" to="/" aria-label="dánwò home">
              <Lockup height={26} className="on-dark" />
            </Link>
            <p>{SITE.tagline}</p>
            <div className="socials">
              {github && (
                <Social href={github} label="danwo on GitHub">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"
                    />
                  </svg>
                </Social>
              )}
              {SITE.social.x && (
                <Social href={SITE.social.x} label="danwo on X">
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.17h1.7L7.4 4.74H5.58l11.09 14.43Z"
                    />
                  </svg>
                </Social>
              )}
              {SITE.social.discord && (
                <Social href={SITE.social.discord} label="danwo on Discord">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M19.6 5.2A17 17 0 0 0 15.4 4l-.5 1a15.7 15.7 0 0 0-5.8 0l-.5-1a17 17 0 0 0-4.2 1.2C1.7 9.2 1 13 1.3 16.8a17 17 0 0 0 5.2 2.6l1.1-1.8a11 11 0 0 1-1.7-.8l.4-.3a12.2 12.2 0 0 0 11.4 0l.4.3-1.7.8 1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.2-3.1-11.6ZM8.5 14.5c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Zm7 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Z"
                    />
                  </svg>
                </Social>
              )}
            </div>
            <span className="foot-pill">
              {version ? `${version} · ${licenceWords()}` : licenceWords()}
            </span>
          </div>
          <Column
            title="Product"
            links={[
              ["How it works", "/#how"],
              ["Fault matrix", "/docs/fault-matrix"],
              ["Emulators", "/docs/providers"],
              ["Dashboard", "/docs/dashboard"],
              ["Mobile", "/docs/mobile"],
              ["Cloud", "/#oss"],
            ]}
          />
          <Column
            title="Docs"
            links={[
              ["Quickstart", "/docs/installation"],
              ["Core concepts", "/docs/agent-and-locators"],
              ["Providers", "/docs/providers"],
              ["Reference", "/docs/reference"],
              ["Examples", "/docs/examples"],
            ]}
          />
          <Column
            title="Resources"
            links={[
              ["Changelog", "/changelog"],
              ["Blog", "/blog"],
              ["llms.txt", "/llms.txt"],
              ...present(["Brand assets", github && `${github}/tree/${SITE.branch}/brand`]),
            ]}
          />
          <Column
            title="Community"
            links={present(
              ["GitHub", github],
              ["X", SITE.social.x],
              ["Discord", SITE.social.discord],
            )}
          />
        </div>
        <div className="foot-b">
          <span>© {new Date().getFullYear()} danwo</span>
          <span>{licenceWords()}</span>
        </div>
      </div>
    </footer>
  )
}
