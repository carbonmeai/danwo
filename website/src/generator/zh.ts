/**
 * The docs in Simplified Chinese. A page written for the website has a Chinese version when
 * `content/docs/<page>.zh-CN.mdx` sits beside it, titled in its own frontmatter; every other page
 * is shown in English under the Chinese docs, with a note saying so. The tabs and the sidebar's
 * sections are named here, in the terms the Chinese README uses.
 */

/** The language code of the Chinese docs, in file names and addresses (`/zh-CN/docs/...`). */
export const ZH = "zh-CN"

/** Each tab's name and description in Chinese, by its folder. */
export const ZH_TABS: Readonly<
  Record<string, { readonly title: string; readonly description: string }>
> = {
  "(documentation)": { title: "文档", description: "指南与概念" },
  providers: { title: "第三方服务", description: "danwo 模拟的 API" },
  reference: { title: "参考", description: "API、配置与命令行" },
  examples: { title: "示例", description: "可直接运行的项目" },
}

/** Each sidebar section's name in Chinese, by its English name. */
export const ZH_SECTIONS: Readonly<Record<string, string>> = {
  "Get started": "入门",
  "Coding agents": "AI 编程助手",
  "Where danwo runs": "danwo 的运行环境",
  "Core concepts": "核心概念",
  "Fault matrix": "故障矩阵",
  "Real stacks": "真实技术栈",
  "Writing tests": "编写测试",
  Platforms: "平台",
  Running: "运行",
  "For coding agents": "给 AI 编程助手",
  Overview: "概览",
  Payments: "支付",
  "Email and messaging": "邮件与消息",
  Identity: "身份认证",
  Storage: "存储",
  AI: "AI",
  Connectors: "连接器",
  Realtime: "实时",
  Infrastructure: "基础设施",
  "Test API": "测试 API",
  Project: "项目",
  "Matrix and lint": "故障矩阵与检查",
  Providers: "第三方服务",
  Examples: "示例",
}

/** A section's Chinese name; one not listed keeps its English name, which the docs test catches. */
export function zhSection(title: string): string {
  return ZH_SECTIONS[title] ?? title
}

/** The Chinese version of a page written for the website: `quickstart.mdx` → `quickstart.zh-CN.mdx`. */
export function zhFile(file: string): string {
  return file.replace(/\.mdx$/, `.${ZH}.mdx`)
}
