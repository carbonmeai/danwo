import { css, cx } from "@danwo/ui/css"
import { createContext, useContext, type ReactNode } from "react"
import Markdown, { type Components, type Options } from "react-markdown"
import remarkGfm from "remark-gfm"

import {
  remarkCitationMarkers,
  remarkFirstLine,
  remarkHtmlAsText,
  remarkQuoteHighlight,
  safeMarkdownUrl,
  type PlaceMarkers,
} from "./markdown-tree"

type Plugins = NonNullable<Options["remarkPlugins"]>

// A single tilde stays literal, so "~5% to ~7%" is not struck through.
const GFM: Plugins[number] = [remarkGfm, { singleTilde: false }]

const inlineCode = {
  fontFamily: "mono",
  fontSize: "0.92em",
  bg: "palette.gray.3",
  rounded: "sm",
  px: "1",
  py: "0.5",
} as const

const documentStyle = css({
  lineHeight: "1.65",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  "& > :first-child": { mt: "0" },
  "& > :last-child": { mb: "0" },
  "& p, & ul, & ol, & blockquote, & pre, & [data-markdown-table], & hr": {
    my: "2.5",
  },
  // Plain-text values keep their line breaks, as they did before Markdown.
  "& p": { whiteSpace: "pre-line" },
  "& h1, & h2, & h3, & h4, & h5, & h6": {
    fontWeight: "600",
    lineHeight: "1.3",
    mt: "4",
    mb: "2",
  },
  "& h1": { fontSize: "5" },
  "& h2": { fontSize: "4" },
  "& h3": { fontSize: "3" },
  "& h4, & h5, & h6": { fontSize: "inherit" },
  "& ul": { listStyleType: "disc", pl: "5" },
  "& ol": { listStyleType: "decimal", pl: "5" },
  "& li + li": { mt: "1" },
  "& li > ul, & li > ol": { my: "1" },
  "& li:has(> input[type=checkbox])": { listStyleType: "none", ml: "-5" },
  "& li > input[type=checkbox]": { mr: "1.5", verticalAlign: "middle" },
  "& blockquote": {
    borderInlineStartWidth: "3px",
    borderInlineStartStyle: "solid",
    borderInlineStartColor: "palette.gray.6",
    pl: "3",
    color: "text.muted",
  },
  "& a": {
    color: "palette.blue.11",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  "& :not(pre) > code": inlineCode,
  "& pre": {
    fontFamily: "mono",
    fontSize: "0.92em",
    lineHeight: "1.55",
    bg: "palette.gray.2",
    border: "1px solid",
    borderColor: "palette.gray.4",
    rounded: "md",
    p: "3",
    overflowX: "auto",
    whiteSpace: "pre",
    overflowWrap: "normal",
  },
  "& table": {
    borderCollapse: "collapse",
    fontVariantNumeric: "tabular-nums",
  },
  "& th, & td": {
    border: "1px solid",
    borderColor: "palette.gray.4",
    px: "2.5",
    py: "1.5",
    textAlign: "left",
    verticalAlign: "top",
    overflowWrap: "normal",
  },
  "& th": { bg: "palette.gray.2", fontWeight: "600" },
  "& th[align=right], & td[align=right]": { textAlign: "right" },
  "& th[align=center], & td[align=center]": { textAlign: "center" },
  "& hr": { borderTop: "1px solid", borderColor: "palette.gray.4" },
  "& mark": { bg: "palette.amber.4", color: "text.app", rounded: "sm" },
})

const lineStyle = css({ "& code": inlineCode })

/** Links always leave the app in a new tab; a link whose URL was dropped stays text. */
const Link: Components["a"] = ({ href, children }) =>
  href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  )

/** Values never load remote images; the alt text stands in. */
const ImageAlt: Components["img"] = ({ alt }) => (alt ? <span>{alt}</span> : null)

const tableScrollStyle = css({
  maxW: "full",
  overflowX: "auto",
  overscrollBehaviorX: "contain",
  pb: "1.5",
  "&::-webkit-scrollbar": { h: "1.5" },
  "&::-webkit-scrollbar-thumb": { bg: "palette.gray.7", rounded: "full" },
  "&::-webkit-scrollbar-track": { bg: "palette.gray.3", rounded: "full" },
})

/**
 * A table wider than its column scrolls sideways in its own box, so the page around it never does;
 * the box takes focus so the keyboard can scroll it too.
 */
const ScrollingTable: Components["table"] = ({ children }) => (
  <div
    className={tableScrollStyle}
    data-markdown-table=""
    role="region"
    aria-label="Table"
    tabIndex={0}
  >
    <table>{children}</table>
  </div>
)

const RenderMarker = createContext<((index: number) => ReactNode) | null>(null)

const keepTogetherStyle = css({ whiteSpace: "nowrap" })

/**
 * A citation chip where the markers plugin left one, or the unbreakable group of a word and its chips;
 * a stable type, so chips keep focus across renders.
 */
const MarkerSpan: Components["span"] = ({ node, children }) => {
  const render = useContext(RenderMarker)
  const index = node?.properties.dataCitation

  if (typeof index === "number" && render) return render(index)
  if (node?.properties.dataCitationGroup)
    return (
      <span className={keepTogetherStyle} data-citation-group="">
        {children}
      </span>
    )

  return <span>{children}</span>
}

const DOCUMENT_COMPONENTS: Components = {
  a: Link,
  img: ImageAlt,
  span: MarkerSpan,
  table: ScrollingTable,
}

/**
 * A Markdown document. Raw HTML shows as literal text and only http, https and mailto
 * links survive; `markers` places inline citation chips and `highlight` marks a quote.
 */
export function MarkdownDocument({
  text,
  markers,
  highlight,
  className,
}: {
  text: string
  markers?: {
    place: PlaceMarkers
    render: (index: number) => ReactNode
  }
  highlight?: string
  className?: string
}) {
  const plugins: Plugins = [GFM, remarkHtmlAsText]

  if (markers) plugins.push([remarkCitationMarkers, { place: markers.place }])
  if (highlight) plugins.push([remarkQuoteHighlight, { quote: highlight }])

  return (
    <div className={cx(documentStyle, className)} data-markdown="document">
      <RenderMarker.Provider value={markers?.render ?? null}>
        <Markdown
          remarkPlugins={plugins}
          components={DOCUMENT_COMPONENTS}
          urlTransform={safeMarkdownUrl}
          skipHtml
        >
          {text}
        </Markdown>
      </RenderMarker.Provider>
    </div>
  )
}

const LINE_PLUGINS: Plugins = [GFM, remarkHtmlAsText, remarkFirstLine]
const LINE_COMPONENTS: Components = {
  p: ({ children }) => children,
  a: ({ children }) => <span>{children}</span>,
  img: ImageAlt,
}

/** The first meaningful line of a Markdown value, inline and without block syntax, for one-line previews. */
export function MarkdownLine({ text }: { text: string }) {
  return (
    <span className={lineStyle} data-markdown="line">
      <Markdown
        remarkPlugins={LINE_PLUGINS}
        components={LINE_COMPONENTS}
        urlTransform={safeMarkdownUrl}
        skipHtml
      >
        {text}
      </Markdown>
    </span>
  )
}
