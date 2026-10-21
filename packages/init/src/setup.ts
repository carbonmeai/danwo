/**
 * Carrying out the answers: the files, danwo's skill and MCP server for the chosen coding agents,
 * and the packages. The prompts and the flags both end here, so both give the same project.
 */
import { join, relative } from "node:path"

import { initProject } from "@danwo/mcp"
import { installSkill } from "@danwo/skill"

import type { Answers } from "./answers.ts"
import { AGENT_INFO, type PackageSpec } from "./catalog.ts"
import type { Detection } from "./detect.ts"
import { type FileResult, type PlannedFile, writeFiles } from "./files.ts"
import {
  browserCommand,
  type InstallResult,
  installPackages,
  packagesToAdd,
  type Runner,
  runCommand,
  runPlanned,
} from "./install.ts"

/** A file the agent setup touched; `kept` is a skill copy the user edited. */
export interface AgentFileResult {
  readonly file: string
  readonly outcome: "created" | "updated" | "unchanged" | "kept"
}

export interface SetupResult {
  readonly files: readonly FileResult[]
  readonly agentFiles: readonly AgentFileResult[]
  /** The packages added, or why they were not; undefined when there was nothing to add. */
  readonly install: InstallResult | undefined
  /** Packages to add by hand, when installing was turned off. */
  readonly notInstalled: readonly PackageSpec[]
  /** danwo's Chromium, installed after the packages for a browser engine; undefined when not tried. */
  readonly browser: InstallResult | undefined
}

/** The skill folders and MCP client files the chosen agents read. */
function agentTargets(answers: Pick<Answers, "agents" | "mcp">): {
  skillDirs: string[]
  mcpFiles: string[]
} {
  const infos = answers.agents.map((id) => AGENT_INFO[id])

  return {
    skillDirs: [...new Set(infos.map((info) => info.skillDir))],
    mcpFiles: answers.mcp
      ? [...new Set(infos.flatMap((info) => (info.mcpFile === undefined ? [] : [info.mcpFile])))]
      : [],
  }
}

/**
 * The command an agent opened at `detection.agentRoot` starts danwo's MCP server with, when that
 * is a folder above the project: the server must find the project's config from there. pnpm runs
 * the project's own danwo in its folder; the others hoist it, and name the config.
 */
export function mcpCommand(
  detection: Pick<Detection, "root" | "agentRoot" | "packageManager">,
): readonly string[] | undefined {
  const from = relative(detection.agentRoot, detection.root).split("\\").join("/")

  if (from === "") return undefined
  if (detection.packageManager === "pnpm") return ["pnpm", "--dir", from, "exec", "danwo", "mcp"]

  return ["npx", "@danwo/cli", "mcp", "--config", `${from}/danwo.config.ts`]
}

async function setUpAgents(detection: Detection, answers: Answers): Promise<AgentFileResult[]> {
  const root = detection.agentRoot
  const { skillDirs, mcpFiles } = agentTargets(answers)
  const command = mcpCommand(detection)
  const skill = skillDirs.length > 0 ? await installSkill(root, skillDirs) : []
  const mcp =
    mcpFiles.length > 0
      ? await initProject({
          cwd: root,
          clients: mcpFiles,
          skill: false,
          ...(command !== undefined && { command }),
        })
      : []

  /* Named from the project, so a file written at the workspace's root reads as `../../.mcp.json`. */
  return [...skill, ...mcp].map((change) => ({
    ...change,
    file: relative(detection.root, join(root, change.file)),
  }))
}

/** Writes `planned`, sets up the agents and installs what the files import. */
export async function applyAnswers(
  answers: Answers,
  detection: Detection,
  planned: readonly PlannedFile[],
  run: Runner = runCommand,
): Promise<SetupResult> {
  const files = await writeFiles(detection.root, planned, answers.replaceConfig)
  const agentFiles = await setUpAgents(detection, answers)
  const packages = packagesToAdd(answers, detection)
  const install =
    answers.install && packages.length > 0
      ? await installPackages(detection, packages, run)
      : undefined
  const web = answers.engine === "web" || answers.engine === "both"
  const browser =
    answers.install && web && install?.ok !== false
      ? await runPlanned(browserCommand(detection), detection.root, run)
      : undefined

  return { files, agentFiles, install, notInstalled: answers.install ? [] : packages, browser }
}
