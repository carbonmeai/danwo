import { createElement, Fragment } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { siModelcontextprotocol } from "simple-icons"
import { expect, it } from "vitest"

import { ProviderIcon, ToolIcon } from "./providers"

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element)

it("draws each model provider’s mark, in the text colour for the one-colour marks", () => {
  for (const [provider, label] of [
    ["openai", "OpenAI"],
    ["anthropic", "Anthropic"],
    ["google", "Google"],
  ] as const)
    expect(html(createElement(ProviderIcon, { provider }))).toContain(`aria-label="${label}"`)

  expect(html(createElement(ProviderIcon, { provider: "openai" }))).toContain('fill="currentColor"')
})

it("falls back to a neutral icon for a provider without a mark", () => {
  const markup = html(createElement(ProviderIcon, { provider: "mistral" }))

  expect(markup).not.toContain("aria-label")

  expect(markup).toContain("<svg")
})

it("keeps two Google marks’ gradient ids apart on one page", () => {
  const markup = html(
    createElement(
      Fragment,
      null,
      createElement(ProviderIcon, { provider: "google" }),
      createElement(ProviderIcon, { provider: "google" }),
    ),
  )

  const ids = [...markup.matchAll(/ id="([^"]+)"/g)].map((match) => match[1])

  expect(new Set(ids).size).toBe(ids.length)
})

it("uses MCP’s simple-icons mark and a neutral icon for tools without an established mark", () => {
  expect(html(createElement(ToolIcon, { tool: "mcp" }))).toContain(siModelcontextprotocol.path)

  expect(html(createElement(ToolIcon, { tool: "firecrawl" }))).not.toContain("aria-label")
})
