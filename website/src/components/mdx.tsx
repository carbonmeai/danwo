import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"

/** The components MDX pages can use: the docs defaults (cards, callouts, code blocks, tabs). */
export function useMdxComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, ...components } satisfies MDXComponents
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof useMdxComponents>
}
