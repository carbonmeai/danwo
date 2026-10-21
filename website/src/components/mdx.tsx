import { Step, Steps } from "fumadocs-ui/components/steps"
import { Tab, Tabs } from "fumadocs-ui/components/tabs"
import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"
import type { ComponentProps } from "react"

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

/** A link in a page: a plain one to a raw file on the site, else the docs' own link. */
function PageLink(props: ComponentProps<"a">) {
  if (isFileAddress(props.href)) return <a {...props} />

  return <defaultMdxComponents.a {...props} />
}

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
 * tabs, badges, and danwo's diagrams.
 */
export function useMdxComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    a: PageLink,
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
