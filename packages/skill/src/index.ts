/*
 * What coding agents read about danwo: the skill installed into a project's agent folders, the
 * task guides, and the capability spec generated from the installed version's code.
 */
export { guideIndex, type GuideInfo, listGuides, readGuide } from "./guides.ts"
export { installSkill, SKILL_DIRS, SKILL_FILE, type SkillChange } from "./install.ts"
export {
  clientCommand,
  type InitChange,
  type InitOptions,
  initProject,
  initReport,
} from "./mcp-clients.ts"
export { buildSpec, type SpecOptions, specTopic } from "./spec/build.ts"
export {
  type CliArgument,
  type CliCommand,
  type CliOption,
  SPEC_TOPICS,
  type Spec,
  type SpecEntry,
  type SpecMember,
  type SpecSection,
  type SpecTopic,
} from "./spec/model.ts"
export { renderSpec, specJson } from "./spec/render.ts"
