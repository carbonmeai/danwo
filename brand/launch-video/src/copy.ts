/**
 * Every word the film puts on screen, in each language it is cut in. A line that arrives word by
 * word is split on its spaces: Chinese is written as short phrases with a space between each, and
 * drawn without the gap (see `Words`). `dim` names the words or phrases drawn muted.
 *
 * What danwo itself prints stays in English in every cut: the fault names, the matrix's failed
 * trial, `danwo init`'s list of files and the test's code, as a developer would see them.
 */
import { createContext, useContext } from "react"

/** A line that arrives word by word, and the words in it drawn muted. */
export interface Line {
  readonly text: string
  readonly dim?: readonly string[]
}

/** A feature scene's title column. */
export interface Feature {
  readonly kicker: string
  readonly title: Line
  readonly sub: string
}

export interface Copy {
  readonly hook: readonly [Line, Line]
  readonly proof: {
    readonly clicks: Line
    readonly behind: Line
    readonly questions: readonly string[]
    readonly checkout: string
    readonly item: string
    readonly total: string
    readonly pay: string
    readonly thanks: string
    readonly credits: string
    readonly passed: string
  }
  readonly question: readonly [Line, Line]
  /** What danwo is, in one line: the reveal's kicker and the end card's. */
  readonly what: string
  readonly tagline: readonly [Line, Line]
  readonly drive: Feature & {
    readonly targets: readonly [string, string, string]
    readonly testName: string
    readonly agentStep: string
    readonly creditsShown: string
    readonly agentTag: string
    readonly replayed: string
  }
  readonly emulate: Feature & {
    readonly checked: string
    readonly app: string
    readonly through: string
  }
  readonly matrix: Feature
  readonly explain: Feature & { readonly outlet: string }
  readonly agents: Feature & { readonly terminal: string; readonly done: string }
  readonly name: string
}

export const EN: Copy = {
  hook: [
    { text: "Coding agents made code cheap." },
    { text: "Checking it is the bottleneck.", dim: ["Checking", "it", "is", "the"] },
  ],
  proof: {
    clicks: { text: "A test clicks Pay and sees “Thank you.”", dim: ["A", "test", "and", "sees"] },
    behind: { text: "But did everything behind it work?", dim: ["But", "did", "behind", "it"] },
    questions: [
      "Was the card charged once?",
      "Did the webhook arrive?",
      "Was the email sent?",
      "Does the ledger add up?",
    ],
    checkout: "Checkout",
    item: "500 credits",
    total: "Total",
    pay: "Pay $5.00",
    thanks: "Thank you for your purchase",
    credits: "Credits: 500",
    passed: "test passed",
  },
  question: [{ text: "What did this change break," }, { text: "and how sure are we?" }],
  what: "Open-source e2e testing for web and mobile apps",
  tagline: [{ text: "Drive the UI." }, { text: "Judge everything behind it." }],
  drive: {
    kicker: "Drive",
    title: { text: "It drives the app like a user.", dim: ["It", "the", "like", "a"] },
    sub: "In a browser or on an iOS or Android device, with locators, plain-English agent steps, or both.",
    targets: ["Browser", "iOS", "Android"],
    testName: '"buy credits"',
    agentStep: '"buy 500 credits with a test card"',
    creditsShown: '"Credits: 500"',
    agentTag: "agent step",
    replayed: "Recorded once. Replayed with no model calls.",
  },
  emulate: {
    kicker: "Emulate",
    title: { text: "It emulates every service behind it.", dim: ["It", "every", "behind", "it."] },
    sub: "Stripe, Resend, S3, Slack, GitHub, Clerk, the model APIs and more answer from local emulators. No code changes. No sandbox keys.",
    checked: "Each one checked against the real API",
    app: "Your app",
    through: "through danwo's proxy",
  },
  matrix: {
    kicker: "Fault matrix",
    title: { text: "It breaks the run on purpose.", dim: ["It", "the", "run"] },
    sub: "One clean run, replayed once per fault: declined cards, 500s, timeouts, duplicate or forged webhooks, double-submits, lost commits, time jumps.",
  },
  explain: {
    kicker: "Flight record",
    title: { text: "It explains every run.", dim: ["It", "every", "run."] },
    sub: "The video, each step, every provider call and webhook, the database statements, with secrets redacted.",
    outlet: "GitHub Check & PR comment",
  },
  agents: {
    kicker: "Agents",
    title: { text: "Your coding agent checks its own work.", dim: ["Your", "its", "own"] },
    sub: "A skill that teaches it danwo, and an MCP server to run tests, drive the app and read every flight record.",
    terminal: "Terminal",
    done: "Skill and MCP server, set up in one command.",
  },
  name: "Dánwò: Yorùbá for “try it and see.”",
}

export const ZH: Copy = {
  hook: [
    { text: "AI 编程助手 让写代码 变得廉价。" },
    { text: "验证代码 才是 瓶颈。", dim: ["验证代码", "才是"] },
  ],
  proof: {
    clicks: { text: "测试 点击「支付」， 看到了 「感谢购买」。", dim: ["测试", "看到了"] },
    behind: { text: "但背后的 一切 真的 都正常吗？", dim: ["但背后的", "真的"] },
    questions: ["卡只扣了一次款吗？", "Webhook 送达了吗？", "邮件发出去了吗？", "账目对得上吗？"],
    checkout: "结账",
    item: "500 积分",
    total: "合计",
    pay: "支付 $5.00",
    thanks: "感谢购买",
    credits: "积分：500",
    passed: "测试通过",
  },
  question: [{ text: "这次改动 破坏了 什么？" }, { text: "我们 有多 确定？" }],
  what: "开源的 Web 与移动应用端到端测试框架",
  tagline: [{ text: "驱动界面，" }, { text: "检验 背后的 一切。" }],
  drive: {
    kicker: "驱动",
    title: { text: "它像 真实用户 一样 操作应用。", dim: ["它像", "一样"] },
    sub: "在浏览器、iOS 或 Android 设备上运行。用定位器、用自然语言写的智能体步骤，或两者结合。",
    targets: ["浏览器", "iOS", "Android"],
    testName: '"购买积分"',
    agentStep: '"用测试卡购买 500 积分"',
    creditsShown: '"积分：500"',
    agentTag: "智能体步骤",
    replayed: "录制一次，回放时不再调用模型。",
  },
  emulate: {
    kicker: "模拟",
    title: { text: "它模拟 背后的 每一个 服务。", dim: ["背后的", "每一个"] },
    sub: "Stripe、Resend、S3、Slack、GitHub、Clerk、各家模型 API 等，都由本地模拟器应答。无需改代码，也无需沙箱密钥。",
    checked: "每一个都与真实 API 对照验证",
    app: "你的应用",
    through: "经由 danwo 代理",
  },
  matrix: {
    kicker: "故障矩阵",
    title: { text: "它 主动向运行 注入故障。", dim: ["它", "主动向运行"] },
    sub: "一次干净的运行，按每种故障各回放一次：被拒的卡、500、超时、重复或伪造的 webhook、重复提交、丢失的提交、时间跳跃。",
  },
  explain: {
    kicker: "运行记录",
    title: { text: "它 讲清楚 每一次运行。", dim: ["它", "每一次运行。"] },
    sub: "视频、每一步、每次服务调用和 webhook、数据库语句，密钥都已脱敏。",
    outlet: "GitHub Check 与 PR 评论",
  },
  agents: {
    kicker: "AI 编程助手",
    title: {
      text: "你的 AI 编程助手 自己 检验 自己的成果。",
      dim: ["你的", "自己", "自己的成果。"],
    },
    sub: "一个教它使用 danwo 的 Skill，加上一个 MCP 服务器：运行测试、驱动应用、读取每一份运行记录。",
    terminal: "终端",
    done: "Skill 与 MCP 服务器，一条命令配好。",
  },
  name: "Dánwò：约鲁巴语，意思是“试试看”。",
}

const CopyContext = createContext<Copy>(EN)

export const CopyProvider = CopyContext.Provider

/** The words of the cut being rendered. */
export function useCopy(): Copy {
  return useContext(CopyContext)
}
