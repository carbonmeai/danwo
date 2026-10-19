/**
 * The landing page's code tabs: the example shop's real test and config, highlighted at build
 * time in the site's own colours, so the page ships HTML and no highlighter.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { codeToHtml, type ThemeRegistrationRaw } from "shiki"

import { REPO_ROOT } from "./danwo.ts"

/** One tab: its label and its highlighted lines. */
export interface CodeSample {
  readonly label: string
  readonly html: string
}

/** The editor panel's colours: keywords red, strings green, calls blue, comments grey. */
const THEME: ThemeRegistrationRaw = {
  name: "danwo-editor",
  type: "dark",
  settings: [
    { settings: { foreground: "#c6c6c6", background: "#0a0a0b" } },
    {
      scope: ["keyword", "storage", "storage.type", "keyword.control"],
      settings: { foreground: "#ff7479" },
    },
    { scope: ["string", "string.regexp"], settings: { foreground: "#3ddc78" } },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "#6aa8f0" },
    },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#5e5e5e" } },
    { scope: ["constant.numeric", "constant.language"], settings: { foreground: "#f5b84f" } },
    {
      scope: ["entity.name.type", "support.type", "support.class"],
      settings: { foreground: "#57d6c0" },
    },
  ],
}

/** The files the tabs show, with the lines worth pointing at. */
const SAMPLES = [
  {
    label: "buy-credits.danwo.ts",
    file: "examples/shop/tests/buy-credits.danwo.ts",
    mark: ["invariant", "toBe(await"],
  },
  {
    label: "danwo.config.ts",
    file: "examples/shop/danwo.config.ts",
    mark: ["stripeEnvironment({", "stripe.proxy.env("],
  },
] as const

/** Highlights one file, marking the lines that contain any of `mark`. */
async function highlight(path: string, mark: readonly string[]): Promise<string> {
  const code = readFileSync(join(REPO_ROOT, path), "utf8").trimEnd()

  return codeToHtml(code, {
    lang: "ts",
    theme: THEME,
    transformers: [
      {
        /* Lines are blocks of their own, so the newlines between them would double the spacing. */
        code(node) {
          node.children = node.children.filter((child) => child.type === "element")
        },
        line(node, line) {
          const text = code.split("\n")[line - 1] ?? ""

          this.addClassToHast(node, mark.some((needle) => text.includes(needle)) ? "l hl" : "l")
        },
      },
    ],
  })
}

/** Every tab's highlighted code. */
export async function codeSamples(): Promise<CodeSample[]> {
  return Promise.all(
    SAMPLES.map(async (sample) => ({
      label: sample.label,
      html: await highlight(sample.file, sample.mark),
    })),
  )
}
