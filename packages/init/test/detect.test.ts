import { describe, expect, it } from "vitest"

import { PROVIDER_IDS, PROVIDERS } from "../src/catalog.ts"
import {
  detectProject,
  frameworkOf,
  keyFound,
  packageManagerOf,
  portIn,
  providersOf,
  runScript,
  sourceWithKey,
} from "../src/detect.ts"
import { nextApp, project } from "./project.ts"

describe("the package manager", () => {
  it("is the one package.json declares, before any lockfile", async () => {
    const root = await project({ "yarn.lock": "" })

    expect(packageManagerOf(root, { packageManager: "pnpm@9.0.0" }, undefined)).toBe("pnpm")
  })

  it("is the lockfile's, then the one running init, then npm", async () => {
    expect(packageManagerOf(await project({ "bun.lock": "" }), {}, undefined)).toBe("bun")
    expect(packageManagerOf(await project({ "yarn.lock": "" }), {}, undefined)).toBe("yarn")
    expect(packageManagerOf(await project(), {}, "pnpm/9.1.0 node/v24")).toBe("pnpm")
    expect(packageManagerOf(await project(), {}, undefined)).toBe("npm")
  })

  it("runs scripts its own way", () => {
    expect(runScript("npm", "dev")).toBe("npm run dev")
    expect(runScript("bun", "dev")).toBe("bun run dev")
    expect(runScript("pnpm", "dev")).toBe("pnpm dev")
    expect(runScript("yarn", "dev")).toBe("yarn dev")
  })
})

describe("the framework", () => {
  it("is found by its package, Expo and meta-frameworks before the Vite they run on", () => {
    expect(frameworkOf(new Set(["expo", "react-native", "vite"])).id).toBe("expo")
    expect(frameworkOf(new Set(["@tanstack/react-start", "vite"])).id).toBe("tanstack-start")
    expect(frameworkOf(new Set(["@react-router/dev", "vite"])).port).toBe(5173)
    expect(frameworkOf(new Set(["vite"])).id).toBe("vite")
    expect(frameworkOf(new Set(["express"]))).toMatchObject({ id: "plain", port: 3000 })
  })

  it("answers on the port its dev script names", () => {
    expect(portIn("next dev -p 4000")).toBe(4000)
    expect(portIn("vite --port=5174")).toBe(5174)
    expect(portIn("PORT=8080 node server.js")).toBe(8080)
    expect(portIn("vite")).toBeUndefined()
  })
})

describe("providers", () => {
  it("are found by package, by scope and by variable name", () => {
    expect(providersOf(new Set(["stripe", "@slack/bolt"]), new Set(["COMPOSIO_API_KEY"]))).toEqual([
      "stripe",
      "slack",
      "composio",
    ])
  })

  it("list every provider the catalogue has, in order", () => {
    expect([...PROVIDER_IDS].toSorted()).toEqual(Object.keys(PROVIDERS).toSorted())
  })
})

describe("detectProject", () => {
  it("reads a Next.js app: its manager, dev command, URL, providers and agents", async () => {
    const root = await project({
      "package.json": nextApp({ resend: "4.0.0" }),
      "pnpm-lock.yaml": "",
      "tsconfig.json": "{}",
      ".env.local": "STRIPE_SECRET_KEY=sk_test_x\nANTHROPIC_API_KEY=\n",
      ".claude/settings.json": "{}",
    })
    const found = await detectProject(root, {})

    expect(found).toMatchObject({
      name: "shop",
      packageManager: "pnpm",
      framework: { id: "next" },
      devScript: "dev",
      devCommand: "pnpm dev",
      appUrl: "http://localhost:3000",
      typescript: true,
      providers: ["stripe", "resend"],
      agents: ["claude"],
      hasConfig: false,
      expo: undefined,
    })
    expect(keyFound(found, "STRIPE_SECRET_KEY")).toBe(true)
    /* An empty value is no key. */
    expect(keyFound(found, "ANTHROPIC_API_KEY")).toBe(false)
  })

  it("counts names in .env.example as mentions, not as keys that are set", async () => {
    const root = await project({
      "package.json": {},
      ".env.example": "AI_GATEWAY_API_KEY=xyz\nPAYSTACK_SECRET_KEY=\n",
    })
    const found = await detectProject(root, {})

    expect(found.providers).toEqual(["paystack"])
    expect(sourceWithKey(found)).toBeUndefined()
    expect(sourceWithKey(await detectProject(root, { OPENAI_API_KEY: "sk" }))).toBe("openai")
  })

  it("reads an Expo app's Android package and scheme", async () => {
    const root = await project({
      "package.json": {
        name: "app",
        dependencies: { expo: "54.0.0" },
        scripts: { start: "expo start" },
      },
      "app.json": { expo: { name: "Shop", scheme: "shop", android: { package: "com.acme.shop" } } },
    })
    const found = await detectProject(root, {})

    expect(found).toMatchObject({
      framework: { id: "expo" },
      devCommand: "npm run start",
      expo: { name: "Shop", scheme: "shop", androidPackage: "com.acme.shop" },
    })
  })

  it("copes with a folder that has no package.json", async () => {
    const found = await detectProject(await project({ "danwo.config.ts": "" }), {})

    expect(found).toMatchObject({ hasPackageJson: false, hasConfig: true, devScript: undefined })
    expect(found.devCommand).toBe("node server.js")
  })
})
