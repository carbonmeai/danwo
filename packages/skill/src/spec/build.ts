/**
 * `danwo spec`: the capability catalog coding agents read, built from danwo's code each time it
 * is asked for. Declarations come from the sources, the rest from the tables the code runs on, so
 * the spec cannot fall behind what the installed danwo does.
 */
import { cacheSection, cliSection, errorSection, faultSection, lintSection } from "./generated.ts"
import { type CliCommand, isSpecTopic, SPEC_TOPICS, type Spec, type SpecTopic } from "./model.ts"
import { apiSections, exportsSection } from "./sections.ts"
import { SourceIndex } from "./source.ts"

export interface SpecOptions {
  /** The CLI's commands; the `cli` section is left out without them. */
  readonly commands?: readonly CliCommand[]
}

/** The whole spec, its sections in `SPEC_TOPICS` order. */
export function buildSpec(options: SpecOptions = {}): Spec {
  const index = new SourceIndex()
  const sections = [
    ...apiSections(index),
    faultSection(index),
    ...(options.commands === undefined ? [] : [cliSection(options.commands)]),
    errorSection(),
    cacheSection(index),
    lintSection(),
    exportsSection(index),
  ]

  return { sections: sections.toSorted((a, b) => order(a.topic) - order(b.topic)) }
}

/** Where a section sorts in the spec. */
function order(topic: SpecTopic): number {
  return SPEC_TOPICS.indexOf(topic)
}

/** The spec narrowed to one section; throws, naming the topics, for an unknown one. */
export function specTopic(spec: Spec, topic: string): Spec {
  if (!isSpecTopic(topic))
    throw new Error(`unknown spec topic "${topic}" (topics: ${SPEC_TOPICS.join(", ")})`)

  return { sections: spec.sections.filter((section) => section.topic === topic) }
}
