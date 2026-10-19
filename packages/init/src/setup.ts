/**
 * Carrying out the answers: the files, danwo's skill and MCP server for the chosen coding agents,
 * and the packages. The prompts and the flags both end here, so both give the same project.
 */
import { initProject } from "@danwo/mcp"
import { installSkill } from "@danwo/skill"

import type { Answers } from "./answers.ts"
import { AGENT_INFO, type PackageSpec } from "./catalog.ts"
import type { Detection } from "./detect.ts"
import { type FileResult, type PlannedFile, writeFiles } from "./files.ts"
import {
  type InstallResult,
  installPackages,
  packagesToAdd,
  type Runner,
  runCommand,
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

async function setUpAgents(root: string, answers: Answers): Promise<AgentFileResult[]> {
  const { skillDirs, mcpFiles } = agentTargets(answers)
  const skill = skillDirs.length > 0 ? await installSkill(root, skillDirs) : []
  const mcp =
    mcpFiles.length > 0 ? await initProject({ cwd: root, clients: mcpFiles, skill: false }) : []

  return [...skill, ...mcp]
}

/** Writes `planned`, sets up the agents and installs what the files import. */
export async function applyAnswers(
  answers: Answers,
  detection: Detection,
  planned: readonly PlannedFile[],
  run: Runner = runCommand,
): Promise<SetupResult> {
  const files = await writeFiles(detection.root, planned, answers.replaceConfig)
  const agentFiles = await setUpAgents(detection.root, answers)
  const packages = packagesToAdd(answers, detection)
  const install =
    answers.install && packages.length > 0
      ? await installPackages(detection.root, detection.packageManager, packages, run)
      : undefined

  return { files, agentFiles, install, notInstalled: answers.install ? [] : packages }
}
