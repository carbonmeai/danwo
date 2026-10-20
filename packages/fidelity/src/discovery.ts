/**
 * API descriptions from documents that are not OpenAPI: Google's Discovery documents, and the
 * parts of Microsoft Graph's OpenAPI description the suites read. Both become the
 * {@link ApiDescription} the documented goldens are built from.
 */
import { parse as parseYaml } from "yaml"

import type { ApiDescription } from "./openapi.ts"

type Node = { readonly [key: string]: unknown }

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function children(value: unknown): Node[] {
  return isNode(value) ? Object.values(value).filter(isNode) : []
}

/**
 * A Discovery schema as JSON schema: `$ref: "Message"` points at the API's own namespaced schema,
 * and `type: "any"` is dropped, since Discovery uses it for values of any type.
 */
function asJsonSchema(value: unknown, api: string): unknown {
  if (Array.isArray(value)) return value.map((item) => asJsonSchema(item, api))
  if (!isNode(value)) return value

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      if (key === "$ref" && typeof child === "string")
        return [[key, `#/components/schemas/${api}.${child}`]]
      if (key === "type" && child === "any") return []

      return [[key, asJsonSchema(child, api)]]
    }),
  )
}

/** Every method of a Discovery document, nested resources included. */
function methodsOf(resource: Node): Node[] {
  return [
    ...children(resource["methods"]),
    ...children(resource["resources"]).flatMap((child) => methodsOf(child)),
  ]
}

/**
 * One Discovery document's methods as `paths`, under `/<servicePath><path>`: the answer of a
 * method with a response is its 200; a method that answers nothing is left without one.
 */
function discoveryPaths(document: Node, api: string): Record<string, Record<string, unknown>> {
  const service = typeof document["servicePath"] === "string" ? document["servicePath"] : ""
  const paths: Record<string, Record<string, unknown>> = {}

  for (const method of methodsOf(document)) {
    const path = typeof method["path"] === "string" ? method["path"].replace(/\{\+/g, "{") : ""
    const verb = typeof method["httpMethod"] === "string" ? method["httpMethod"].toLowerCase() : ""
    const response = isNode(method["response"]) ? asJsonSchema(method["response"], api) : undefined
    const answers =
      response === undefined
        ? {}
        : { "200": { content: { "application/json": { schema: response } } } }

    paths[`/${service}${path}`] = { ...paths[`/${service}${path}`], [verb]: { responses: answers } }
  }

  return paths
}

/** Google's Discovery documents, keyed by a short API name (`gmail`), as one API description. */
export function discoveryDescription(documents: Readonly<Record<string, unknown>>): ApiDescription {
  const paths: Record<string, Record<string, unknown>> = {}
  const schemas: Record<string, Node> = {}

  for (const [api, document] of Object.entries(documents)) {
    if (!isNode(document)) continue

    Object.assign(paths, discoveryPaths(document, api))

    for (const [name, schema] of Object.entries(
      isNode(document["schemas"]) ? document["schemas"] : {},
    ))
      if (isNode(schema)) {
        const converted = asJsonSchema(schema, api)

        if (isNode(converted)) schemas[`${api}.${name}`] = converted
      }
  }

  return { paths, components: { schemas } }
}

/** Response ranges as single statuses, the form the documented goldens look answers up by. */
const RANGES: Readonly<Record<string, readonly string[]>> = {
  "2XX": ["200", "201", "202", "204"],
  "4XX": ["400", "401", "403", "404", "409"],
  "5XX": ["500", "503"],
}

/** An operation's answers with ranges spread out and shared answers (`$ref`) put in place. */
function answersOf(operation: Node, shared: Node): Record<string, unknown> {
  const answers: Record<string, unknown> = {}

  for (const [status, answer] of Object.entries(
    isNode(operation["responses"]) ? operation["responses"] : {},
  )) {
    const ref = isNode(answer) ? answer["$ref"] : undefined
    const body = typeof ref === "string" ? shared[ref.split("/").at(-1) ?? ""] : answer

    for (const code of RANGES[status] ?? [status]) answers[code] = body
  }

  return answers
}

/**
 * OData's control annotations, which Graph puts on answers but its description leaves out: the
 * context URL and entity tags on every object, and a file's short-lived download link.
 */
const ANNOTATIONS: Readonly<Record<string, Node>> = {
  "@odata.context": { type: "string" },
  "@odata.etag": { type: "string" },
  "@odata.nextLink": { type: "string" },
}
const FILE_ANNOTATIONS: Readonly<Record<string, Node>> = {
  "@microsoft.graph.downloadUrl": { type: "string" },
}

/** A schema with the annotations its answers may carry added as optional properties. */
function annotated(name: string, schema: Node): Node {
  const properties = isNode(schema["properties"]) ? schema["properties"] : undefined
  const extra =
    name === "microsoft.graph.driveItem" ? { ...ANNOTATIONS, ...FILE_ANNOTATIONS } : ANNOTATIONS

  if (properties !== undefined) return { ...schema, properties: { ...extra, ...properties } }

  const members = Array.isArray(schema["allOf"]) ? schema["allOf"] : undefined

  return members === undefined
    ? schema
    : { ...schema, allOf: [...members, { type: "object", properties: extra }] }
}

/**
 * Graph's schemas as the suites compare answers with: the type annotation they all require is
 * only sent where a value's type is not the one the schema names, so it is not required, and the
 * control annotations Graph does send are allowed.
 */
function graphSchemas(schemas: Node): Record<string, Node> {
  return Object.fromEntries(
    Object.entries(schemas).flatMap(([name, schema]) => {
      const cleaned = unrequireType(schema)

      return isNode(cleaned) ? [[name, annotated(name, cleaned)]] : []
    }),
  )
}

function unrequireType(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unrequireType)
  if (!isNode(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "required" && Array.isArray(child)
        ? child.filter((name) => name !== "@odata.type")
        : unrequireType(child),
    ]),
  )
}

/** Microsoft Graph's OpenAPI description, kept to `wanted` paths: the parts the suites read. */
export function graphDescription(text: string, wanted: readonly string[]): ApiDescription {
  const parsed: unknown = parseYaml(text, { maxAliasCount: -1 })

  if (!isNode(parsed) || !isNode(parsed["paths"]) || !isNode(parsed["components"]))
    throw new Error("the text is not Microsoft Graph's OpenAPI description")

  const allPaths = parsed["paths"]
  const components = parsed["components"]
  const shared = isNode(components["responses"]) ? components["responses"] : {}
  const paths = Object.fromEntries(
    wanted.map((path) => {
      const item = allPaths[path]

      if (!isNode(item)) throw new Error(`Graph's description has no ${path}`)

      return [
        `/v1.0${path}`,
        Object.fromEntries(
          Object.entries(item).flatMap(([verb, operation]) =>
            isNode(operation) && isNode(operation["responses"])
              ? [[verb, { responses: answersOf(operation, shared) }]]
              : [],
          ),
        ),
      ]
    }),
  )

  return {
    paths,
    components: {
      schemas: graphSchemas(isNode(components["schemas"]) ? components["schemas"] : {}),
    },
  }
}
