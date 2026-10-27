/**
 * The docs' languages: English at `/docs/...`, and Simplified Chinese at `/zh-CN/docs/...`. A page
 * written in Chinese sits beside its English one as `<page>.zh-CN.mdx`; a page not yet translated
 * is shown in English under the Chinese docs. Only the docs are translated.
 */
import { defineI18n } from "fumadocs-core/i18n"
import { defineI18nUI } from "fumadocs-ui/i18n"

export type Lang = "en" | "zh-CN"

export const i18n = defineI18n<Lang>({
  languages: ["en", "zh-CN"],
  defaultLanguage: "en",
  hideLocale: "default-locale",
  parser: "dot",
})

/** The docs' own words (search, the table of contents, page actions) in each language. */
export const i18nUI = defineI18nUI(i18n, {
  en: { displayName: "English" },
  "zh-CN": {
    displayName: "简体中文",
    "Search(search trigger)": "搜索",
    "Search(search dialog)": "搜索",
    "No results found(search dialog)": "没有找到结果",
    "On this page(table of contents)": "本页内容",
    "No Headings(table of contents)": "没有标题",
    "Next Page(pagination)": "下一页",
    "Previous Page(pagination)": "上一页",
    "Choose a language(language switcher)": "选择语言",
    "Choose a language(language switcher)(aria-label)": "选择语言",
    "Open Search(search trigger)(aria-label)": "打开搜索",
    "Close Search(search dialog)(aria-label)": "关闭搜索",
    "Copy Text(code block)(aria-label)": "复制代码",
    "Copied Text(code block)(aria-label)": "已复制代码",
    "Copy Anchor Link(heading anchor)(aria-label)": "复制标题链接",
    "Toggle Theme(theme switcher)(aria-label)": "切换主题",
    "Light(theme switcher)(aria-label)": "浅色",
    "Dark(theme switcher)(aria-label)": "深色",
    "System(theme switcher)(aria-label)": "跟随系统",
    "Open Sidebar(sidebar)(aria-label)": "打开侧边栏",
    "Collapse Sidebar(sidebar)(aria-label)": "收起侧边栏",
    "Toggle Menu(mobile menu)(aria-label)": "切换菜单",
    "Copy Markdown(page actions)": "复制 Markdown",
    "Copied Markdown(page actions)": "已复制 Markdown",
    "View as Markdown(page actions)": "以 Markdown 查看",
    "Open(page actions)": "打开",
    "Edit on GitHub(edit page)": "在 GitHub 上编辑",
    "Last updated on(page footer)": "最后更新于",
    "Page Not Found(404 page)": "页面不存在",
    "Back to Home(404 page)": "返回首页",
  },
})

/** What a docs page in `lang` says when it has not been translated yet. */
export const UNTRANSLATED: Readonly<Record<Lang, string | undefined>> = {
  en: undefined,
  "zh-CN": "本页还没有中文版，下面是英文原文。",
}

/** The address of the docs page at `path` (an English `/docs/...` address) in `lang`. */
export function docsPath(path: string, lang: Lang): string {
  return lang === "en" ? path : `/${lang}${path}`
}

/** The language of the docs page at `pathname`, from its prefix. */
export function langOf(pathname: string): Lang {
  return pathname === "/zh-CN" || pathname.startsWith("/zh-CN/") ? "zh-CN" : "en"
}

/** The same page in the other language: `/zh-CN/docs/x` ↔ `/docs/x`. */
export function counterpart(pathname: string, lang: Lang): string {
  const english = pathname.replace(/^\/zh-CN(?=\/|$)/, "") || "/"

  return docsPath(english, lang)
}
