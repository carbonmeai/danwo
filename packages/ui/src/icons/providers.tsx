import { css } from "@danwo/ui/css"
import { useId, type ReactElement } from "react"
import { siModelcontextprotocol } from "simple-icons"

import { Icons } from "./base"

/**
 * Model providers' and vendors' marks, drawn inline so every app gets them from here. OpenAI, Anthropic and MCP are
 * one flat shape in the text colour, so they read in light and dark; Google's G keeps its own colours. The OpenAI,
 * Anthropic and Google marks are the files the dashboard shipped; MCP comes from simple-icons (CC0).
 */
type MarkProps = { size?: number; title?: string }

const mark = css({ flexShrink: "0" })

const OpenAiMark = ({ size = 12, title = "OpenAI" }: MarkProps) => (
  <svg
    aria-label={title}
    className={mark}
    fill="currentColor"
    height={size}
    role="img"
    viewBox="0 0 256 260"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z" />
  </svg>
)

const AnthropicMark = ({ size = 12, title = "Anthropic" }: MarkProps) => (
  <svg
    aria-label={title}
    className={mark}
    fill="currentColor"
    fillRule="evenodd"
    height={size}
    role="img"
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-7.258 0h3.767L16.906 20h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm4.132 9.959L8.453 7.687 6.205 13.48H10.7z" />
  </svg>
)

/** Its gradients need ids; useId keeps them apart when the mark appears many times on a page. */
const GoogleMark = ({ size = 12, title = "Google" }: MarkProps) => {
  const p = useId().replaceAll(":", "")

  return (
    <svg
      aria-label={title}
      className={mark}
      height={size}
      overflow="hidden"
      role="img"
      viewBox="0 0 268.152 273.883"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`${p}a`}>
          <stop offset="0" stopColor="#0fbc5c" />
          <stop offset="1" stopColor="#0cba65" />
        </linearGradient>
        <linearGradient id={`${p}g`}>
          <stop offset=".231" stopColor="#0fbc5f" />
          <stop offset=".312" stopColor="#0fbc5f" />
          <stop offset=".366" stopColor="#0fbc5e" />
          <stop offset=".458" stopColor="#0fbc5d" />
          <stop offset=".54" stopColor="#12bc58" />
          <stop offset=".699" stopColor="#28bf3c" />
          <stop offset=".771" stopColor="#38c02b" />
          <stop offset=".861" stopColor="#52c218" />
          <stop offset=".915" stopColor="#67c30f" />
          <stop offset="1" stopColor="#86c504" />
        </linearGradient>
        <linearGradient id={`${p}h`}>
          <stop offset=".142" stopColor="#1abd4d" />
          <stop offset=".248" stopColor="#6ec30d" />
          <stop offset=".312" stopColor="#8ac502" />
          <stop offset=".366" stopColor="#a2c600" />
          <stop offset=".446" stopColor="#c8c903" />
          <stop offset=".54" stopColor="#ebcb03" />
          <stop offset=".616" stopColor="#f7cd07" />
          <stop offset=".699" stopColor="#fdcd04" />
          <stop offset=".771" stopColor="#fdce05" />
          <stop offset=".861" stopColor="#ffce0a" />
        </linearGradient>
        <linearGradient id={`${p}f`}>
          <stop offset=".316" stopColor="#ff4c3c" />
          <stop offset=".604" stopColor="#ff692c" />
          <stop offset=".727" stopColor="#ff7825" />
          <stop offset=".885" stopColor="#ff8d1b" />
          <stop offset="1" stopColor="#ff9f13" />
        </linearGradient>
        <linearGradient id={`${p}b`}>
          <stop offset=".231" stopColor="#ff4541" />
          <stop offset=".312" stopColor="#ff4540" />
          <stop offset=".458" stopColor="#ff4640" />
          <stop offset=".54" stopColor="#ff473f" />
          <stop offset=".699" stopColor="#ff5138" />
          <stop offset=".771" stopColor="#ff5b33" />
          <stop offset=".861" stopColor="#ff6c29" />
          <stop offset="1" stopColor="#ff8c18" />
        </linearGradient>
        <linearGradient id={`${p}d`}>
          <stop offset=".408" stopColor="#fb4e5a" />
          <stop offset="1" stopColor="#ff4540" />
        </linearGradient>
        <linearGradient id={`${p}c`}>
          <stop offset=".132" stopColor="#0cba65" />
          <stop offset=".21" stopColor="#0bb86d" />
          <stop offset=".297" stopColor="#09b479" />
          <stop offset=".396" stopColor="#08ad93" />
          <stop offset=".477" stopColor="#0aa6a9" />
          <stop offset=".568" stopColor="#0d9cc6" />
          <stop offset=".667" stopColor="#1893dd" />
          <stop offset=".769" stopColor="#258bf1" />
          <stop offset=".859" stopColor="#3086ff" />
        </linearGradient>
        <linearGradient id={`${p}e`}>
          <stop offset=".366" stopColor="#ff4e3a" />
          <stop offset=".458" stopColor="#ff8a1b" />
          <stop offset=".54" stopColor="#ffa312" />
          <stop offset=".616" stopColor="#ffb60c" />
          <stop offset=".771" stopColor="#ffcd0a" />
          <stop offset=".861" stopColor="#fecf0a" />
          <stop offset=".915" stopColor="#fecf08" />
          <stop offset="1" stopColor="#fdcd01" />
        </linearGradient>
        <linearGradient
          href={`#${p}a`}
          id={`${p}s`}
          x1="219.7"
          x2="254.467"
          y1="329.535"
          y2="329.535"
          gradientUnits="userSpaceOnUse"
        />
        <radialGradient
          href={`#${p}b`}
          id={`${p}m`}
          cx="109.627"
          cy="135.862"
          r="71.46"
          fx="109.627"
          fy="135.862"
          gradientTransform="matrix(-1.93688 1.043 1.45573 2.55542 290.525 -400.634)"
          gradientUnits="userSpaceOnUse"
        />
        <radialGradient
          href={`#${p}c`}
          id={`${p}n`}
          cx="45.259"
          cy="279.274"
          r="71.46"
          fx="45.259"
          fy="279.274"
          gradientTransform="matrix(-3.5126 -4.45809 -1.69255 1.26062 870.8 191.554)"
          gradientUnits="userSpaceOnUse"
        />
        <radialGradient
          href={`#${p}d`}
          id={`${p}l`}
          cx="304.017"
          cy="118.009"
          r="47.854"
          fx="304.017"
          fy="118.009"
          gradientTransform="matrix(2.06435 0 0 2.59204 -297.679 -151.747)"
          gradientUnits="userSpaceOnUse"
        />
        <radialGradient
          href={`#${p}e`}
          id={`${p}o`}
          cx="181.001"
          cy="177.201"
          r="71.46"
          fx="181.001"
          fy="177.201"
          gradientTransform="matrix(-.24858 2.08314 2.96249 .33417 -255.146 -331.164)"
          gradientUnits="userSpaceOnUse"
        />
        <radialGradient
          href={`#${p}f`}
          id={`${p}p`}
          cx="207.673"
          cy="108.097"
          r="41.102"
          fx="207.673"
          fy="108.097"
          gradientTransform="matrix(-1.2492 1.34326 -3.89684 -3.4257 880.501 194.905)"
          gradientUnits="userSpaceOnUse"
        />
        <radialGradient
          href={`#${p}g`}
          id={`${p}r`}
          cx="109.627"
          cy="135.862"
          r="71.46"
          fx="109.627"
          fy="135.862"
          gradientTransform="matrix(-1.93688 -1.043 1.45573 -2.55542 290.525 838.683)"
          gradientUnits="userSpaceOnUse"
        />
        <radialGradient
          href={`#${p}h`}
          id={`${p}j`}
          cx="154.87"
          cy="145.969"
          r="71.46"
          fx="154.87"
          fy="145.969"
          gradientTransform="matrix(-.0814 -1.93722 2.92674 -.11625 -215.135 632.86)"
          gradientUnits="userSpaceOnUse"
        />
        <filter
          id={`${p}q`}
          width="1.097"
          height="1.116"
          x="-.048"
          y="-.058"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="1.701" />
        </filter>
        <filter
          id={`${p}k`}
          width="1.033"
          height="1.02"
          x="-.017"
          y="-.01"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation=".242" />
        </filter>
        <clipPath id={`${p}i`} clipPathUnits="userSpaceOnUse">
          <path d="M371.378 193.24H237.083v53.438h77.167c-1.241 7.563-4.026 15.003-8.105 21.786-4.674 7.773-10.451 13.69-16.373 18.196-17.74 13.498-38.42 16.258-52.783 16.258-36.283 0-67.283-23.286-79.285-54.928-.484-1.149-.805-2.335-1.197-3.507a81.115 81.115 0 0 1-4.101-25.448c0-9.226 1.569-18.057 4.43-26.398 11.285-32.897 42.985-57.467 80.179-57.467 7.481 0 14.685.884 21.517 2.648a77.668 77.668 0 0 1 33.425 18.25l40.834-39.712c-24.839-22.616-57.219-36.32-95.844-36.32-30.878 0-59.386 9.553-82.748 25.7-18.945 13.093-34.483 30.625-44.97 50.985-9.753 18.879-15.094 39.8-15.094 62.294 0 22.495 5.35 43.633 15.103 62.337v.126c10.302 19.857 25.368 36.954 43.678 49.988 15.997 11.386 44.68 26.551 84.031 26.551 22.63 0 42.687-4.051 60.375-11.644 12.76-5.478 24.065-12.622 34.301-21.804 13.525-12.132 24.117-27.139 31.347-44.404 7.23-17.265 11.097-36.79 11.097-57.957 0-9.858-.998-19.87-2.689-28.968Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${p}i)`} transform="matrix(.95792 0 0 .98525 -90.174 -78.856)">
        <path
          fill={`url(#${p}j)`}
          d="M92.076 219.958c.148 22.14 6.501 44.983 16.117 63.424v.127c6.949 13.392 16.445 23.97 27.26 34.452l65.327-23.67c-12.36-6.235-14.246-10.055-23.105-17.026-9.054-9.066-15.802-19.473-20.004-31.677h-.17l.17-.127c-2.765-8.058-3.037-16.613-3.14-25.503Z"
          filter={`url(#${p}k)`}
        />
        <path
          fill={`url(#${p}l)`}
          d="M237.083 79.025c-6.456 22.526-3.988 44.421 0 57.161 7.457.006 14.64.888 21.45 2.647a77.662 77.662 0 0 1 33.424 18.25l41.88-40.726c-24.81-22.59-54.667-37.297-96.754-37.332Z"
          filter={`url(#${p}k)`}
        />
        <path
          fill={`url(#${p}m)`}
          d="M236.943 78.847c-31.67 0-60.91 9.798-84.871 26.359a145.533 145.533 0 0 0-24.332 21.15c-1.904 17.744 14.257 39.551 46.262 39.37 15.528-17.936 38.495-29.542 64.056-29.542l.07.002-1.044-57.335c-.048 0-.093-.004-.14-.004Z"
          filter={`url(#${p}k)`}
        />
        <path
          fill={`url(#${p}n)`}
          d="m341.475 226.379-28.268 19.285c-1.24 7.562-4.028 15.002-8.107 21.786-4.674 7.772-10.45 13.69-16.373 18.196-17.702 13.47-38.328 16.244-52.687 16.255-14.842 25.102-17.444 37.675 1.043 57.934 22.877-.016 43.157-4.117 61.046-11.796 12.931-5.551 24.388-12.792 34.761-22.097 13.706-12.295 24.442-27.503 31.769-45 7.327-17.497 11.245-37.282 11.245-58.734Z"
          filter={`url(#${p}k)`}
        />
        <path
          fill="#3086ff"
          d="M234.996 191.21v57.498h136.006c1.196-7.874 5.152-18.064 5.152-26.5 0-9.858-.996-21.899-2.687-30.998Z"
          filter={`url(#${p}k)`}
        />
        <path
          fill={`url(#${p}o)`}
          d="M128.39 124.327c-8.394 9.119-15.564 19.326-21.249 30.364-9.753 18.879-15.094 41.83-15.094 64.324 0 .317.026.627.029.944 4.32 8.224 59.666 6.649 62.456 0-.004-.31-.039-.613-.039-.924 0-9.226 1.57-16.026 4.43-24.367 3.53-10.289 9.056-19.763 16.123-27.926 1.602-2.031 5.875-6.397 7.121-9.016.475-.997-.862-1.557-.937-1.908-.083-.393-1.876-.077-2.277-.37-1.275-.929-3.8-1.414-5.334-1.845-3.277-.921-8.708-2.953-11.725-5.06-9.536-6.658-24.417-14.612-33.505-24.216Z"
          filter={`url(#${p}k)`}
        />
        <path
          fill={`url(#${p}p)`}
          d="M162.099 155.857c22.112 13.301 28.471-6.714 43.173-12.977l-25.574-52.664a144.74 144.74 0 0 0-26.543 14.504c-12.316 8.512-23.192 18.9-32.176 30.72Z"
          filter={`url(#${p}q)`}
        />
        <path
          fill={`url(#${p}r)`}
          d="M171.099 290.222c-29.683 10.641-34.33 11.023-37.062 29.29a144.806 144.806 0 0 0 16.792 13.984c15.996 11.386 46.766 26.551 86.118 26.551.046 0 .09-.004.137-.004v-59.157l-.094.002c-14.736 0-26.512-3.843-38.585-10.527-2.977-1.648-8.378 2.777-11.123.799-3.786-2.729-12.9 2.35-16.183-.938Z"
          filter={`url(#${p}k)`}
        />
        <path
          fill={`url(#${p}s)`}
          d="M219.7 299.023v59.996c5.506.64 11.236 1.028 17.247 1.028 6.026 0 11.855-.307 17.52-.872v-59.748a105.119 105.119 0 0 1-17.477 1.461c-5.932 0-11.7-.686-17.29-1.865Z"
          filter={`url(#${p}k)`}
          opacity=".5"
        />
      </g>
    </svg>
  )
}

const McpMark = ({ size = 12, title = "MCP" }: MarkProps) => (
  <svg
    aria-label={title}
    className={mark}
    fill="currentColor"
    height={size}
    role="img"
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d={siModelcontextprotocol.path} />
  </svg>
)

/** Model providers with a mark, by the provider part of a gateway model id such as openai/gpt-6-luna. */
const PROVIDER_MARKS: Record<string, (props: MarkProps) => ReactElement> = {
  openai: OpenAiMark,
  anthropic: AnthropicMark,
  google: GoogleMark,
}

/** A model provider's mark; any other provider gets a neutral spark. */
export const ProviderIcon = ({ provider, size = 12 }: { provider: string; size?: number }) => {
  const Mark = PROVIDER_MARKS[provider]

  if (!Mark) return <Icons.magicStar size={size + 4} />

  return <Mark size={size} />
}

/** Unit tools whose vendor has an established mark; the rest get a neutral icon for what they do. */
const TOOL_MARKS: Record<string, (props: MarkProps) => ReactElement> = {
  mcp: McpMark,
}

const TOOL_FALLBACKS: Record<string, keyof typeof Icons> = {
  web_search: "global",
  transcription: "mic",
  ocr: "scan",
  firecrawl: "document",
  boat: "squareCode",
  inngest_sandbox: "squareCode",
  code_runner: "code",
  composio_tool: "integrations",
  composio_trigger: "lightning",
  turbopuffer_write: "database",
  turbopuffer_query: "database",
  typesafe: "aiChip",
}

/** A unit tool's vendor mark where one exists, else a neutral icon; never a hand-drawn logo. */
export const ToolIcon = ({ tool, size = 14 }: { tool: string; size?: number }) => {
  const Mark = TOOL_MARKS[tool]

  if (Mark) return <Mark size={size} />

  const Fallback = Icons[TOOL_FALLBACKS[tool] ?? "setting"]

  return <Fallback size={size} />
}
