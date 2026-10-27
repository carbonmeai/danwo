import { Card } from "fumadocs-ui/components/card"
import { Step, Steps } from "fumadocs-ui/components/steps"
import { Tab, Tabs } from "fumadocs-ui/components/tabs"
import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"
import type { ComponentProps } from "react"

import { docsPath, type Lang } from "../lib/i18n.ts"
import { isFileAddress } from "../lib/paths.ts"
import {
  AwsRouting,
  EmulatorFlow,
  HowItWorks,
  IsolationSlots,
  MatrixFlow,
  ProviderFlow,
  ProxyBoundary,
  ReplayFlow,
  Setup,
} from "./diagrams.tsx"
import { StackFlow } from "./stack-diagram.tsx"

/** `href` in a page in `lang`: a docs page in the same language, any other address as it is. */
function localised(href: string | undefined, lang: Lang): string | undefined {
  return href?.startsWith("/docs") && !isFileAddress(href) ? docsPath(href, lang) : href
}

/** A link in a page: a plain one to a raw file on the site, else the docs' own link. */
function linkIn(lang: Lang) {
  return function PageLink(props: ComponentProps<"a">) {
    if (isFileAddress(props.href)) return <a {...props} />

    return <defaultMdxComponents.a {...props} href={localised(props.href, lang)} />
  }
}

/** A card in a page, linking to the docs page in the page's own language. */
function cardIn(lang: Lang) {
  return function PageCard(props: ComponentProps<typeof Card>) {
    return <Card {...props} href={localised(props.href, lang)} />
  }
}

const LINKS = { en: linkIn("en"), "zh-CN": linkIn("zh-CN") }
const CARDS = { en: cardIn("en"), "zh-CN": cardIn("zh-CN") }

/** A row of small labels, such as an example's stack. */
function Badges({ items }: { readonly items: readonly string[] }) {
  return (
    <span className="not-prose my-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex h-5 items-center rounded-full border border-fd-border bg-fd-muted px-2 text-xs font-medium text-fd-muted-foreground"
        >
          {item}
        </span>
      ))}
    </span>
  )
}

/**
 * The components MDX pages can use: the docs defaults (cards, callouts, code blocks), steps,
 * tabs, badges, and danwo's diagrams. In a page in `lang`, links and cards to docs pages stay in
 * that language.
 */
export function useMdxComponents(components?: MDXComponents, lang: Lang = "en") {
  return {
    ...defaultMdxComponents,
    a: LINKS[lang],
    Card: CARDS[lang],
    Step,
    Steps,
    Tab,
    Tabs,
    Badges,
    HowItWorks,
    MatrixFlow,
    AwsRouting,
    ProviderFlow,
    ProxyBoundary,
    Setup,
    ReplayFlow,
    EmulatorFlow,
    IsolationSlots,
    StackFlow,
    ...components,
  } satisfies MDXComponents
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof useMdxComponents>
}
