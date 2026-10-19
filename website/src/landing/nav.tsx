import { Link } from "@tanstack/react-router"
import { useTheme } from "next-themes"
import { type RefObject, useEffect, useState } from "react"

import { Glyph } from "../components/brand.tsx"
import { repoUrl } from "../lib/site.ts"
import { GithubIcon, MenuIcon, MoonIcon, SunIcon } from "./glyphs.tsx"

/** A star count as the nav shows it: 2412 → "2.4k". */
function compact(stars: number): string {
  return stars < 1000 ? String(stars) : `${(stars / 1000).toFixed(1).replace(/\.0$/, "")}k`
}

/** Switches between light and dark, remembering the choice. */
function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Toggle colour theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <span className="only-light">
        <SunIcon />
      </span>
      <span className="only-dark">
        <MoonIcon />
      </span>
    </button>
  )
}

/** The page's links, by the section they jump to. */
const LINKS = [
  { href: "#how", text: "How it works" },
  { href: "#features", text: "Product" },
  { href: "/docs", text: "Docs" },
  { href: "#compare", text: "Compare" },
  { href: "#oss", text: "Cloud" },
] as const

/** The sticky navigation bar: dark over the hero, light once the hero has scrolled away. */
export function Nav({
  hero,
  stars,
}: {
  readonly hero: RefObject<HTMLElement | null>
  readonly stars: number | undefined
}) {
  const [light, setLight] = useState(false)
  const [open, setOpen] = useState(false)
  const github = repoUrl()

  useEffect(() => {
    const element = hero.current

    if (!element) return undefined

    const observer = new IntersectionObserver(
      ([entry]) => setLight(!(entry?.isIntersecting ?? true)),
      {
        rootMargin: "-64px 0px 0px 0px",
      },
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [hero])

  return (
    <header className={["nav", light && "light", open && "open"].filter(Boolean).join(" ")}>
      <div className="wrap">
        <Link to="/" className="danwo-brand" aria-label="danwo home">
          <span className="danwo-glyph">
            <Glyph />
          </span>
          danwo
        </Link>
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.text}
            </a>
          ))}
        </nav>
        <div className="nav-right">
          {github && (
            <a className="stars" href={github} aria-label="danwo on GitHub">
              <GithubIcon />
              Star{stars !== undefined && <b>{compact(stars)}</b>}
            </a>
          )}
          <ThemeButton />
          <Link className="btn btn-solid" to="/docs/$" params={{ _splat: "installation" }}>
            Get started
          </Link>
          <button
            type="button"
            className="icon-btn menu-btn"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <MenuIcon />
          </button>
        </div>
      </div>
    </header>
  )
}
