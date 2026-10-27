<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/readme-hero/hero-dark.png">
  <img src="brand/readme-hero/hero-light.png" alt="dánwò：驱动界面，检验背后的一切。" width="100%">
</picture>

<br>

<h3 align="center">dánwò</h3>

<p align="center">
  开源的 Web 与移动应用端到端测试框架。<br>  像真实用户一样通过界面操作你的应用，需要时再检验它背后发生的一切。
  <br>
  <a href="https://danwo.dev"><strong>了解更多 »</strong></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="https://danwo.dev/docs/quickstart">快速开始</a> ·
  <a href="https://danwo.dev/docs">文档</a> ·
  <a href="https://danwo.dev/docs/what-you-can-test">测试范围</a> ·
  <a href="https://danwo.dev/docs/fault-matrix">故障矩阵</a> ·
  <a href="https://danwo.dev/docs/coding-agents">AI 编程助手</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-Apache--2.0-blue" alt="许可证：Apache-2.0"></a>
  <img src="https://img.shields.io/badge/node-22.22.3%2B%20%7C%2024.11.1%2B-339933?logo=nodedotjs&logoColor=white" alt="Node 22.22.3+ 或 24.11.1+">
  <a href="https://www.npmjs.com/package/@danwo/cli"><img src="https://img.shields.io/npm/v/@danwo/cli?logo=npm&color=cb3837" alt="npm @danwo/cli"></a>
  <img src="https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white" alt="TypeScript">
</p>

<br>

danwo 本身就是一个完整的 UI 测试框架：定位器、用自然语言写的智能体步骤（录制后回放，不再调用模型）、截图对比，可以在浏览器、Android 或 iOS 上运行。当你的应用涉及支付、发送邮件或处理 webhook 时，再打开后端层：模拟的第三方服务、不变性校验（invariant），以及内置的故障注入（故障矩阵）。

> 文档目前只有英文版，网址是 [danwo.dev](https://danwo.dev)。命令行输出和报错信息也是英文的。

## 测试示例

### 使用定位器：无需模型

```ts
import { test } from "@danwo/sdk"

test("signs up", async ({ app, screen, expect }) => {
  await app.open("/sign-up")
  await screen.getByLabel("Email").fill("ada@example.com")
  await screen.getByLabel("Password").fill("correct horse battery staple")
  await screen.getByRole("button", { name: "Create account" }).click()

  await expect(screen.getByRole("heading", { name: "Welcome, Ada" })).toBeVisible()
})
```

运行它不需要模型，也不需要 API 密钥。

### 使用自然语言：首次运行调用模型，后续使用缓存

```ts
import { test } from "@danwo/sdk"

test("buys two mugs", async ({ app, agent, screen, expect }) => {
  await app.open("/")
  await agent.act("把两个蓝色马克杯加入购物车，然后去结账")
  await agent.assert("购物车里有两个蓝色马克杯")

  await expect(screen).toHaveScreenshot("checkout")
})
```

第一次运行需要一个模型和它的 API 密钥：每一步交给模型，由模型决定点击哪里，danwo 把这些操作录制下来。之后的运行直接回放录制，不再调用模型。把录制提交到仓库，CI 也会回放它；用 `danwo test --replay-only` 可以确保 CI 里不会调用模型。只有当页面变化大到录制不再适用时，这一步才会重新交给模型。

## 快速开始

你需要 Node.js 22.22.3 或更高的 22 版本，或 24.11.1 及以上，系统可以是 macOS、Linux 或 Windows（Web 测试；移动端测试需要 macOS 或 Linux）。在你的应用目录下运行：

```sh
npx @danwo/cli init
npm run test:danwo
```

`init` 会问你要测试什么、用哪个模型和哪些第三方服务（只测 UI 的话可以都不选），以及要配置哪些 AI 编程助手。它会写好一份配置和一个能通过的测试，并安装浏览器。详见[快速开始](https://danwo.dev/docs/quickstart)。

## 需要时再加上后端层

|                    |                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **模拟第三方服务** | Stripe、Clerk、Resend、Google、Slack 等 20 多个服务由代理后面的本地模拟器应答。无需沙箱密钥，无需改代码。        |
| **检验后端**       | 测试结束后，不变性校验会读取数据库和第三方服务，确认只有一行数据、一笔扣款和一封邮件。                           |
| **主动注入故障**   | `danwo matrix` 为每种故障把测试重跑一次：500、拒付、重复的 webhook、丢失的数据库提交。不变性校验检验每一次运行。 |

```ts
test("joins the waitlist", async ({ app, screen, expect }) => {
  await app.open("/")
  await screen.getByLabel("Work email").fill(EMAIL)
  await screen.getByRole("button", { name: "Join the waitlist" }).click()

  await expect(screen.getByRole("status")).toContainText("You're on the list")
}).invariant(async ({ databaseUrl, resend, expect }) => {
  // 不管中途出了什么问题：一行数据，一封欢迎邮件。
  expect(await sql(databaseUrl, "select id from signups where email = $1", [EMAIL])).toHaveLength(1)
  expect(resendInbox(resend).list(EMAIL)).toHaveLength(1)
})
```

```sh
npx @danwo/cli matrix tests/waitlist.danwo.ts
```

```text
PASS  status 429 on POST api.resend.com/emails
PASS  reset-after on POST api.resend.com/emails
PASS  serialization_failure on INSERT signups (postgres)
PASS  double-submit on POST /api/join
…
faults: 16 passed
```

如果移除应用中的幂等键，会有两次试验失败（变红），因为系统多发了一封欢迎邮件。故障是根据测试实际发出的调用规划出来的，并在 danwo 的代理处注入，所以不需要任何额外配置，每个结果都能复现。详见[故障矩阵](https://danwo.dev/docs/fault-matrix)。

无论是否打开后端层，每次运行都会留下一份完整的运行记录（就像飞机的黑匣子）：视频、每一步，以及背后的每一次调用，可以在仪表盘、PR 评论和 MCP 中查看。

## 示例

每个示例都不需要真实密钥。克隆、安装、测试即可。

| 示例                                    | 展示内容                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| [`commerce`](examples/commerce)         | 基于 Next.js、Hono、Postgres 和 Stripe Checkout 的商店，成功通过 86 种故障测试。 |
| [`saas`](examples/saas)                 | 工作区、试用和计费、Slack 和 Google、Inngest 任务、实时笔记。                    |
| [`clerk-login`](examples/clerk-login)   | 真实的 Clerk 组件、Google 登录和组织邀请，在模拟器上运行。                       |
| [`better-auth`](examples/better-auth)   | 自托管的 Better Auth：邮件验证码、Google 和 GitHub、关联账号。                   |
| [`with-next`](examples/with-next)       | 最小的示例：一个基于 Postgres 和 Resend 的 Next.js 等候名单。                    |
| [`with-swiftui`](examples/with-swiftui) | 同一个等候名单，做成原生 SwiftUI 应用，在 iOS 模拟器上运行。                     |
| [`with-compose`](examples/with-compose) | 同一个等候名单，做成原生 Jetpack Compose 应用，在 Android 模拟器上运行。         |
| [`with-flutter`](examples/with-flutter) | 同一个等候名单，做成 Flutter 应用，在 Android 或 iOS 模拟器上运行。              |

更多示例见[示例库](https://danwo.dev/docs/examples)。

## 在哪里运行

|                                                      |                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| [Web 应用](https://danwo.dev/docs/web)               | 任何框架，由 danwo 启动或已经在运行的都可以。                 |
| [Android](https://danwo.dev/docs/android-tests)      | 模拟器上的 Expo、React Native、Jetpack Compose 和 View 应用。 |
| [iOS](https://danwo.dev/docs/ios-tests)              | iOS 模拟器上的 Expo、React Native、SwiftUI 和 UIKit 应用。    |
| [Playwright Test](https://danwo.dev/docs/playwright) | 保留你现有的测试，加上模拟器和故障矩阵。                      |
| [从 Cypress 迁移](https://danwo.dev/docs/cypress)    | 一次迁移一个 spec，逐步搬过来。                               |
| [从 Detox 迁移](https://danwo.dev/docs/detox)        | 一次迁移一个测试文件，逐步搬过来。                            |
| [真实技术栈](https://danwo.dev/docs/real-stacks)     | 多个应用、后台任务、数据库和队列，都在同一个代理后面。        |
| [CI](https://danwo.dev/docs/ci)                      | 提供 GitHub Check 和 PR 评论，清晰指出故障原因及责任归属。    |
| [AI 编程助手](https://danwo.dev/docs/coding-agents)  | 为 Claude Code、Cursor 和 Codex 提供的 Skill 和 MCP 服务器。  |

## 参与贡献

需要 Node 22.22.3+ 或 24.11.1+，以及 bun：

```sh
bun install
bun run check
```

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[行为准则](CODE_OF_CONDUCT.md)，报告安全漏洞请看[SECURITY.md](SECURITY.md)。请注意，danwo 目前仍处于早期阶段，API 可能会发生变动。

## 名字的由来

_Dánwò_ 是约鲁巴语，意思是“测试”。它来自 _dán … wò_，意为“试试看”：把东西拿去检验，看看会发生什么。读作 _DAHN-woh_，先高后低。

## 许可证

代码采用 [Apache License 2.0](LICENSE) 许可。dánwò 的名称和标志是 Carbonme Inc 的商标，详见[TRADEMARKS.md](TRADEMARKS.md)。
