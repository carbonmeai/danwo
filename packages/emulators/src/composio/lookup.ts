/** The catalogue as the API serves it: the built-in entries with the seed's custom ones added. */
import { TOOLKITS, TOOLS, TRIGGER_TYPES } from "./catalog.ts"
import type { ToolDefinition, ToolkitDefinition, TriggerTypeDefinition } from "./entities.ts"
import { toolkitKey } from "./helpers.ts"
import type { ComposioStore } from "./store.ts"

export function allToolkits(objects: ComposioStore): ToolkitDefinition[] {
  return [...TOOLKITS, ...objects.toolkits.all()]
}

export function toolkitOf(objects: ComposioStore, slug: string): ToolkitDefinition | undefined {
  const key = toolkitKey(slug)

  return allToolkits(objects).find((toolkit) => toolkit.slug === key)
}

export function allTools(objects: ComposioStore): ToolDefinition[] {
  return [...TOOLS, ...objects.tools.all()]
}

export function toolOf(objects: ComposioStore, slug: string): ToolDefinition | undefined {
  const key = slug.toUpperCase()

  return allTools(objects).find((tool) => tool.slug === key)
}

export function allTriggerTypes(objects: ComposioStore): TriggerTypeDefinition[] {
  return [...TRIGGER_TYPES, ...objects.triggerTypes.all()]
}

export function triggerTypeOf(
  objects: ComposioStore,
  slug: string,
): TriggerTypeDefinition | undefined {
  const key = slug.toUpperCase()

  return allTriggerTypes(objects).find((trigger) => trigger.slug === key)
}

/** A toolkit's display name, or its slug when the catalogue has no such toolkit. */
export function toolkitName(objects: ComposioStore, slug: string): string {
  return toolkitOf(objects, slug)?.name ?? slug
}
