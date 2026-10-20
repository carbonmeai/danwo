import { Step, Steps } from "fumadocs-ui/components/steps"
import { Tab, Tabs } from "fumadocs-ui/components/tabs"
import defaultMdxComponents from "fumadocs-ui/mdx"
import type { MDXComponents } from "mdx/types"

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

/**
 * The components MDX pages can use: the docs defaults (cards, callouts, code blocks), steps,
 * tabs, and danwo's diagrams.
 */
export function useMdxComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Step,
    Steps,
    Tab,
    Tabs,
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
