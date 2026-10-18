import { errorCodeTable, FAULT_FORMS } from "@danwo/runner/runner"
import * as sdk from "@danwo/sdk"
import { describe, expect, it } from "vitest"

import { buildSpec, renderSpec, specJson, SPEC_TOPICS, specTopic } from "../src/index.ts"
import { SOURCES } from "../src/spec/sections.ts"
import { SourceIndex } from "../src/spec/source.ts"

const spec = buildSpec({
  commands: [
    {
      name: "test",
      description: "run test files",
      arguments: [
        { name: "patterns", required: false, variadic: true, description: "paths", choices: [] },
      ],
      options: [
        { flags: "-w, --workers <n>", description: "workers", choices: [], default: undefined },
      ],
    },
  ],
})

function section(topic: string) {
  const found = spec.sections.find((s) => s.topic === topic)

  if (found === undefined) throw new Error(`no section ${topic}`)

  return found
}

describe("danwo spec", () => {
  it("lists every export of @danwo/sdk, each with a doc", () => {
    const listed = section("exports").entries
    const names = new Set(listed.map((entry) => entry.name))
    const runtime = Object.keys(sdk)

    /* Every runtime export, and every type the source declares, is in the spec. */
    for (const name of [...runtime, ...new SourceIndex().names(SOURCES.sdk)])
      expect(names).toContain(name)

    expect(listed.filter((entry) => entry.doc === "").map((entry) => entry.name)).toEqual([])
  })

  it("lists every error code with its class and exit code", () => {
    const errors = section("errors").entries

    expect(errors.map((e) => e.name)).toEqual(errorCodeTable().map((row) => row.code))
    expect(errors.find((e) => e.name === "CONFIG_INVALID")).toMatchObject({
      kind: "config",
      signature: "exit 2",
    })
  })

  it("lists the fault label forms and planned labels per provider", () => {
    const faults = section("faults").entries
    const forms = faults.find((e) => e.name === "label forms")

    expect(forms?.members.map((m) => m.signature)).toEqual(FAULT_FORMS)
    expect(
      faults.find((e) => e.name === "POST api.stripe.com/v1/checkout/sessions")?.signature,
    ).toContain("status 429")
    expect(faults.find((e) => e.name === "webhook checkout.session.completed")?.signature).toBe(
      "duplicate · delay 600000ms · forged · stale 3600s",
    )
    expect(faults.some((e) => e.name.startsWith("slack webhook"))).toBe(true)
  })

  it("documents every cache outcome and the config's keys", () => {
    expect(section("cache").entries.every((e) => e.doc !== "")).toBe(true)

    const config = section("config").entries.find((e) => e.name === "DanwoConfig")

    expect(config?.members.map((m) => m.name)).toEqual(
      expect.arrayContaining(["testDir", "model", "secrets", "environment", "matrix", "readiness"]),
    )
  })

  it("describes the CLI from its definitions", () => {
    expect(section("cli").entries[0]).toMatchObject({
      name: "test",
      signature: "danwo test [patterns...]",
    })
  })

  it("has a section for every topic and renders as text and JSON", () => {
    expect(spec.sections.map((s) => s.topic)).toEqual([...SPEC_TOPICS])

    const agent = renderSpec(specTopic(spec, "agent"))

    expect(agent).toContain("## Agent [agent]")
    expect(agent).toContain("waitFor(condition: string, options?: WaitForOptions): Promise<void>")
    expect(JSON.parse(specJson(spec))).toHaveProperty("sections")
    expect(() => specTopic(spec, "nope")).toThrow(/unknown spec topic "nope"/)
  })
})
