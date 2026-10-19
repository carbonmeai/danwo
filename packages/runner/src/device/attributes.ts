/**
 * Attributes of a device element, by the names a web test already uses: `getAttribute("aria-label")`
 * reads the accessible name, `"data-testid"` React Native's `testID`, `"aria-checked"` a switch's
 * state. A name the device has no counterpart for reads as null, as a missing attribute does.
 */
import type { DeviceNode } from "./types.ts"

/** A state as an attribute value: "true" or "false", null when the element has no such state. */
function flag(value: boolean | undefined): string | null {
  return value === undefined ? null : String(value)
}

/** Readers by attribute name, lower case without dashes or underscores. */
const READERS: Readonly<Record<string, (node: DeviceNode) => string | null>> = {
  testid: (node) => node.testId ?? null,
  datatestid: (node) => node.testId ?? null,
  id: (node) => node.testId ?? null,
  resourceid: (node) => node.testId ?? null,
  arialabel: (node) => node.name || null,
  accessibilitylabel: (node) => node.name || null,
  contentdesc: (node) => node.name || null,
  label: (node) => node.name || null,
  name: (node) => node.name || null,
  text: (node) => node.text,
  value: (node) => (node.password ? null : (node.value ?? null)),
  placeholder: (node) => node.placeholder ?? null,
  hint: (node) => node.placeholder ?? null,
  role: (node) => node.role,
  disabled: (node) => (node.enabled ? null : "true"),
  ariadisabled: (node) => String(!node.enabled),
  enabled: (node) => String(node.enabled),
  checked: (node) => flag(node.checked),
  ariachecked: (node) => flag(node.checked),
  editable: (node) => String(node.editable),
  password: (node) => String(node.password),
}

/** The value of attribute `name` on `node`; null when the device has no such attribute. */
export function attributeOf(node: DeviceNode, name: string): string | null {
  const read = READERS[name.toLowerCase().replaceAll(/[-_]/g, "")]

  return read === undefined ? null : read(node)
}
