import { AbsoluteFill, useCurrentFrame } from "remotion"

import { Card, Chip, ease, Exit, Mono, Sfx, typed } from "../kit.tsx"
import { C } from "../theme.ts"
import { FeatureTitle } from "./feature.tsx"

const COMMAND = "npx @danwo/cli init"
const TYPE_FROM = 14

/** What `danwo init` writes for coding agents, as its output lists it. */
const CREATED: readonly (readonly [string, string])[] = [
  [".claude/skills/danwo/SKILL.md", "skill"],
  [".agents/skills/danwo/SKILL.md", "skill"],
  [".mcp.json", "MCP"],
  [".cursor/mcp.json", "MCP"],
  [".codex/config.toml", "MCP"],
]

const AGENTS = ["Claude Code", "Cursor", "Codex", "Copilot"] as const

/** Feature five: a coding agent gets danwo's skill and MCP server, so it checks its own work. */
export function Agents() {
  const frame = useCurrentFrame()
  const enter = ease(frame, 6, 26)
  const done = ease(frame, 96, 18)

  return (
    <AbsoluteFill>
      <Sfx name="whoosh" at={2} volume={0.3} />
      <Sfx name="typing" at={TYPE_FROM} volume={0.5} />
      <Sfx name="pop" at={96} volume={0.45} />
      <Exit at={122} duration={13}>
        <FeatureTitle
          index="05"
          kicker="Agents"
          title="Your coding agent checks its own work."
          dim={["Your", "its", "own"]}
          sub="A skill that teaches it danwo, and an MCP server to run tests, drive the app and read every flight record."
          top={250}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 40 }}>
            {AGENTS.map((agent, i) => {
              const p = ease(frame, 34 + i * 6, 18)

              return (
                <div key={agent} style={{ opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
                  <Chip>{agent}</Chip>
                </div>
              )
            })}
          </div>
        </FeatureTitle>
        <div
          style={{
            position: "absolute",
            left: 900,
            top: 280,
            width: 900,
            opacity: enter,
            transform: `perspective(2000px) rotateY(${(1 - enter) * -14}deg) translateX(${(1 - enter) * 80}px)`,
          }}
        >
          <Card>
            <div
              style={{
                height: 54,
                display: "flex",
                alignItems: "center",
                padding: "0 24px",
                borderBottom: `1px solid ${C.line}`,
                background: C.raised,
              }}
            >
              <Mono size={19} color={C.muted}>
                Terminal
              </Mono>
            </div>
            <div
              style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 14 }}
            >
              <Mono size={26}>
                <span style={{ color: C.faint }}>$ </span>
                {typed(COMMAND, frame, TYPE_FROM, 0.9)}
              </Mono>
              <Mono
                size={22}
                color={C.muted}
                style={{ marginTop: 18, opacity: ease(frame, 40, 10) }}
              >
                Coding agents
              </Mono>
              {CREATED.map(([path, kind], i) => {
                const p = ease(frame, 46 + i * 9, 10)

                return (
                  <div
                    key={path}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 22,
                      opacity: p,
                      transform: `translateX(${(1 - p) * 16}px)`,
                    }}
                  >
                    <Mono size={22} color={C.pass} style={{ width: 110 }}>
                      created
                    </Mono>
                    <Mono size={22} style={{ flex: 1 }}>
                      {path}
                    </Mono>
                    <Mono
                      size={17}
                      color={kind === "skill" ? "#d2a8ff" : "#93c5fd"}
                      style={{
                        padding: "5px 12px",
                        borderRadius: 8,
                        background:
                          kind === "skill" ? "rgb(168 85 247 / 0.16)" : "rgb(59 130 246 / 0.18)",
                      }}
                    >
                      {kind}
                    </Mono>
                  </div>
                )
              })}
            </div>
          </Card>
          <div
            style={{ marginTop: 28, opacity: done, transform: `translateY(${(1 - done) * 18}px)` }}
          >
            <Chip style={{ fontSize: 28 }}>
              <span style={{ color: C.pass }}>●</span>
              Skill and MCP server, set up in one command.
            </Chip>
          </div>
        </div>
      </Exit>
    </AbsoluteFill>
  )
}
