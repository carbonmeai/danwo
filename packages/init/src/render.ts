/**
 * The files `danwo init` writes, as text: the config (one per engine), an example test that
 * passes on a fresh project, and the variable names for `.env.example`. Everything here is pure,
 * so the same answers always give the same files.
 */
import type { Answers } from "./answers.ts"
import {
  MODEL_SOURCE_INFO,
  OPENROUTER_URL,
  type ModelSourceId,
  PROVIDERS,
  providerList,
  type ProviderId,
} from "./catalog.ts"
import type { Detection } from "./detect.ts"

/** The model part of a config: imports, declarations before the config, and the `model` value. */
interface ModelCode {
  readonly imports: readonly string[]
  readonly preamble: readonly string[]
  readonly expression: string
}

/** Where tests live: one folder, or one per engine when the project has both. */
export function testDirs(answers: Pick<Answers, "engine">): { web: string; mobile: string } {
  return answers.engine === "both"
    ? { web: "tests/web", mobile: "tests/mobile" }
    : { web: "tests", mobile: "tests" }
}

/** The variable holding the model's key, when the source takes one. */
export function modelKeyEnv(answers: Pick<Answers, "modelSource" | "keyEnv">): string | undefined {
  return answers.modelSource === "openai-compatible"
    ? answers.keyEnv
    : MODEL_SOURCE_INFO[answers.modelSource].keyEnv
}

/** A compatible-provider declaration: `const name = createOpenAICompatible({ ... })`. */
function compatibleProvider(
  name: string,
  doc: string,
  baseUrl: string,
  keyEnv: string | undefined,
): readonly string[] {
  return [
    `/** ${doc} */`,
    `const ${name} = createOpenAICompatible({`,
    `  name: ${JSON.stringify(name)},`,
    `  baseURL: ${JSON.stringify(baseUrl)},`,
    ...(keyEnv === undefined ? [] : [`  apiKey: process.env.${keyEnv},`]),
    "})",
    "",
  ]
}

const COMPATIBLE_IMPORT = 'import { createOpenAICompatible } from "@ai-sdk/openai-compatible"'

/** A provider package's default export, called with the model id: `anthropic("…")`. */
function providerPackage(name: "anthropic" | "openai" | "google"): (model: string) => ModelCode {
  return (model) => ({
    imports: [`import { ${name} } from "@ai-sdk/${name}"`],
    preamble: [],
    expression: `${name}(${model})`,
  })
}

/** How each model source's model is written, given the quoted model id. */
const MODEL_CODE: Readonly<
  Record<Exclude<ModelSourceId, "none">, (model: string, answers: Answers) => ModelCode>
> = {
  gateway: (model) => ({ imports: [], preamble: [], expression: model }),
  anthropic: providerPackage("anthropic"),
  openai: providerPackage("openai"),
  google: providerPackage("google"),
  openrouter: (model) => ({
    imports: [COMPATIBLE_IMPORT],
    preamble: compatibleProvider(
      "openrouter",
      "OpenRouter's OpenAI-compatible API.",
      OPENROUTER_URL,
      "OPENROUTER_API_KEY",
    ),
    expression: `openrouter(${model})`,
  }),
  "openai-compatible": (model, answers) => ({
    imports: [COMPATIBLE_IMPORT],
    preamble: compatibleProvider(
      "compatible",
      "A server that speaks OpenAI's chat API; its model must be able to call tools.",
      answers.baseUrl ?? "",
      answers.keyEnv,
    ),
    expression: `compatible(${model})`,
  }),
}

function modelCode(answers: Answers): ModelCode | undefined {
  return answers.modelSource === "none"
    ? undefined
    : MODEL_CODE[answers.modelSource](JSON.stringify(answers.model ?? ""), answers)
}

/** The `model` lines of a config, with where its key comes from. */
function modelLines(answers: Answers, code: ModelCode | undefined): readonly string[] {
  if (code === undefined)
    return [
      "  /* No model: tests use locators. Add one to use `agent.act`, `assert` and `extract`. */",
    ]

  const keyEnv = modelKeyEnv(answers)
  const key = keyEnv === undefined ? "" : ` Its key is read from ${keyEnv}.`

  return [
    ...blockComment(
      `The model agent steps run on: \`agent.act\`, \`agent.assert\`, \`agent.extract\`.${key}`,
      "  ",
    ),
    `  model: ${code.expression},`,
  ]
}

/** `[stripeService(), resendService()]` for the chosen providers. */
function servicesExpression(providers: readonly ProviderId[]): string {
  return `[${providers.map((id) => `${PROVIDERS[id].service}()`).join(", ")}]`
}

/** The SDK names a config imports, sorted. */
function sdkImport(names: readonly string[]): string {
  return `import { ${[...new Set(names)].toSorted().join(", ")} } from "@danwo/sdk"`
}

/** Words wrapped into lines of at most `width` characters, each starting with `prefix`. */
export function wrapped(text: string, prefix: string, width = 100): string[] {
  const lines: string[] = []
  let line = prefix

  for (const word of text.split(" ")) {
    if (line !== prefix && line.length + word.length + 1 > width) {
      lines.push(line)
      line = prefix
    }

    line += line === prefix ? word : ` ${word}`
  }

  return [...lines, line]
}

/** A block comment holding `text`, indented by `indent`. */
function blockComment(text: string, indent = ""): string[] {
  return [`${indent}/**`, ...wrapped(text, `${indent} * `), `${indent} */`]
}

/** The comment above the app: how danwo runs it and what reaches the emulators. */
function appComment(answers: Answers): readonly string[] {
  const through =
    answers.providers.length === 0
      ? "through danwo's proxy; add services below to emulate the providers it calls."
      : `through a proxy that answers ${providerList(answers.providers)} with emulators, so its calls reach them with no code change.`

  return blockComment(
    `The app under test. danwo starts it with \`${answers.devCommand}\` ${through} Set APP_URL to test an app that already runs instead; its calls to providers then reach the real ones.`,
  )
}

const READINESS = [
  "  /* After each action, wait for the page and for the calls it caused behind the app. */",
  '  readiness: { mode: "page+backend", settle: true },',
]

/** `danwo.config.ts` for a browser, or for an API with no browser. */
export function renderWebConfig(answers: Answers, testDir: string): string {
  const model = modelCode(answers)
  const services = answers.providers.map((id) => PROVIDERS[id].service)
  const app = { command: answers.devCommand, url: answers.appUrl }

  return [
    ...(model?.imports ?? []),
    sdkImport(["appEnvironment", "defineConfig", ...services]),
    "",
    ...(model?.preamble ?? []),
    ...appComment(answers),
    `const app = process.env.APP_URL ?? ${objectLiteral(app)}`,
    "",
    "export default defineConfig({",
    `  testDir: ${JSON.stringify(testDir)},`,
    "  /* One app answers at that URL, so tests run in one worker. */",
    "  workers: 1,",
    "  timeout: 60_000,",
    ...browserLines(answers),
    ...modelLines(answers, model),
    ...READINESS,
    "  environment: () =>",
    `    appEnvironment({ app, services: ${servicesExpression(answers.providers)} }),`,
    "})",
    "",
  ].join("\n")
}

/** The config's `browser.name`, when the project runs in more than Chromium. */
function browserLines(answers: Pick<Answers, "browsers">): string[] {
  const { browsers } = answers

  if (browsers.length === 1 && browsers[0] === "chromium") return []

  const name =
    browsers.length === 1
      ? JSON.stringify(browsers[0])
      : `[${browsers.map((b) => JSON.stringify(b)).join(", ")}]`

  return [
    "  /* Every test runs once in each browser, its result labelled with the browser. */",
    `  browser: { name: ${name} },`,
  ]
}

/** `{ command: "npm run dev", url: "http://localhost:3000" }`. */
function objectLiteral(value: Readonly<Record<string, string>>): string {
  const fields = Object.entries(value).map(([key, field]) => `${key}: ${JSON.stringify(field)}`)

  return `{ ${fields.join(", ")} }`
}

/** The Android app's identity, from app.json, with stand-ins where it says nothing. */
function androidApp(detection: Pick<Detection, "expo">): { package: string; scheme?: string } {
  const scheme = detection.expo?.scheme

  return {
    package: detection.expo?.androidPackage ?? "com.example.app",
    ...(scheme !== undefined && { scheme }),
  }
}

/** The mobile config: an Expo app built for danwo, on an Android emulator bound to the proxy. */
export function renderMobileConfig(
  answers: Answers,
  detection: Pick<Detection, "expo">,
  testDir: string,
): string {
  const model = modelCode(answers)
  const services = answers.providers.map((id) => PROVIDERS[id].service)
  const { package: androidPackage, scheme } = androidApp(detection)
  const appFields = [
    `package: ${JSON.stringify(androidPackage)}`,
    "apk: build.apk",
    ...(scheme === undefined ? [] : [`scheme: ${JSON.stringify(scheme)}`]),
  ].join(", ")

  return [
    ...(model?.imports ?? []),
    'import { buildAndroid, withAndroidDevice } from "@danwo/mobile"',
    sdkImport(["appEnvironment", "defineConfig", ...services]),
    "",
    ...(model?.preamble ?? []),
    "/** The Android Virtual Device tests boot; `danwo device doctor` lists this machine's. */",
    `const AVD = process.env.DANWO_AVD ?? ${JSON.stringify(answers.avd ?? "danwo")}`,
    "",
    "export default defineConfig({",
    `  testDir: ${JSON.stringify(testDir)},`,
    "  timeout: 120_000,",
    ...modelLines(answers, model),
    ...READINESS,
    "  async environment({ workerIndex }) {",
    "    /* Built once with danwo's certificate trusted; an unchanged app reuses its kept APK. */",
    '    const build = await buildAndroid({ project: "." })',
    `    const services = await appEnvironment({ services: ${servicesExpression(answers.providers)} })`,
    "",
    "    return withAndroidDevice(services, {",
    "      avd: AVD,",
    "      worker: workerIndex,",
    `      app: { ${appFields} },`,
    "    })",
    "  },",
    "})",
    "",
  ].join("\n")
}

/** The comment in the example test that shows how to check what reached the emulators. */
function emulatorExample(providers: readonly ProviderId[]): readonly string[] {
  const first = providers[0]

  if (first === undefined) return []

  const reads = providers.map((id) => ` *   ${id}: ${PROVIDERS[id].read}`)
  const verb = providers.length === 1 ? "is" : "are"

  return [
    "",
    "/*",
    ...wrapped(
      `${providerList(providers)} ${verb} emulated: tests and invariants get each emulator as a fixture named after it, and read what the app did with it:`,
      " * ",
    ),
    ...reads,
    " *",
    ...wrapped(
      "An invariant must hold however a test went; `danwo matrix` replays the test under every fault it plans and judges each run by it (`danwo guide matrix`):",
      " * ",
    ),
    " *",
    ` *   test("…", async ({ agent }) => { … }).invariant(async ({ ${first}, expect }) => {`,
    ` *     expect(<what ${first} shows>).toBe(<what the app shows>)`,
    " *   })",
    " */",
  ]
}

/** An agent step to try, once a model is configured. */
function agentExample(answers: Pick<Answers, "modelSource">): readonly string[] {
  if (answers.modelSource === "none") return []

  return [
    "",
    "/* With the model set up, steps can be plain words; each is recorded once, then replayed: */",
    '/* await agent.assert("the page shows the app\'s home screen") */',
  ]
}

/** An example web test that passes on a fresh project: the home page answers and opens. */
export function renderWebTest(answers: Answers): string {
  return [
    'import { test } from "@danwo/sdk"',
    "",
    'test("the home page opens", async ({ app, expect }) => {',
    '  const response = await fetch(new URL("/", app.baseUrl))',
    "",
    "  expect(response.status).toBeLessThan(400)",
    '  await app.open("/")',
    "})",
    ...agentExample(answers),
    ...emulatorExample(answers.providers),
    "",
  ].join("\n")
}

/** An example API test, for a project with no browser: the app answers HTTP. */
export function renderApiTest(answers: Answers): string {
  return [
    'import { test } from "@danwo/sdk"',
    "",
    'test("the app answers", async ({ app, expect }) => {',
    '  const response = await fetch(new URL("/", app.baseUrl))',
    "",
    "  expect(response.status).toBeLessThan(500)",
    "})",
    ...emulatorExample(answers.providers),
    "",
  ].join("\n")
}

/** An example mobile test: each attempt installs and starts the app, so starting is the check. */
export function renderMobileTest(answers: Answers): string {
  return [
    'import { test } from "@danwo/sdk"',
    "",
    'test("the app starts", async () => {',
    "  /* Each attempt installs and starts the app afresh; a crash on launch fails this test. */",
    "})",
    ...agentExample(answers),
    ...emulatorExample(answers.providers),
    "",
  ].join("\n")
}

/** The variable names `.env.example` should list, so a teammate knows what to set. */
export function envExampleNames(answers: Pick<Answers, "modelSource" | "keyEnv">): string[] {
  const keyEnv = modelKeyEnv(answers)

  return keyEnv === undefined ? [] : [keyEnv]
}
