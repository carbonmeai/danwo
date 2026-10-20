import { describe, expect, it } from "vitest"

import {
  checkAccount,
  GOOGLE_ACCOUNT,
  MICROSOFT_ACCOUNT,
  WorkAccountRefused,
} from "../src/accounts.ts"
import { discoveryDescription, graphDescription } from "../src/discovery.ts"
import { documentedShape } from "../src/openapi.ts"
import { googleFidelity } from "../src/providers/google.ts"
import { microsoftFidelity } from "../src/providers/microsoft.ts"
import { runScenario } from "../src/scenario.ts"

describe("the account the suites act as", () => {
  it("lets a personal account through, and a work one only when it is named", () => {
    expect(() => checkAccount(GOOGLE_ACCOUNT, "tester@gmail.com", {})).not.toThrow()
    expect(() => checkAccount(MICROSOFT_ACCOUNT, "tester@outlook.com", {})).not.toThrow()
    expect(() => checkAccount(GOOGLE_ACCOUNT, "ada@acme.com", {})).toThrow(WorkAccountRefused)
    expect(() =>
      checkAccount(MICROSOFT_ACCOUNT, "qa@acme.onmicrosoft.com", {
        DANWO_FIDELITY_MICROSOFT_ACCOUNT: "QA@acme.onmicrosoft.com",
      }),
    ).not.toThrow()
  })

  it("skips the account scenarios without a signed-in account, pointing at the login", async () => {
    for (const provider of [googleFidelity, microsoftFidelity]) {
      const target = provider.live({ DANWO_FIDELITY_PUBLIC: "1" })
      const scenario = provider.scenarios.at(-1)

      expect(target).toBeDefined()
      expect(scenario).toBeDefined()
      if (target === undefined || scenario === undefined) continue

      const run = await runScenario(scenario, target)

      expect(run.skipped).toContain(`danwo fidelity login ${provider.name}`)
      expect(run.steps).toEqual([])
    }
  })
})

describe("descriptions that are not one OpenAPI file", () => {
  it("reads Google's Discovery documents as paths and namespaced schemas", () => {
    const description = discoveryDescription({
      gmail: {
        servicePath: "",
        resources: {
          users: {
            resources: {
              labels: {
                methods: {
                  get: {
                    httpMethod: "GET",
                    path: "gmail/v1/users/{userId}/labels/{id}",
                    response: { $ref: "Label" },
                  },
                  delete: { httpMethod: "DELETE", path: "gmail/v1/users/{userId}/labels/{id}" },
                },
              },
            },
          },
        },
        schemas: {
          Label: { type: "object", properties: { id: { type: "string" }, extra: { type: "any" } } },
        },
      },
    })
    const shape = documentedShape(description, {
      operation: "GET /gmail/v1/users/{userId}/labels/{id}",
      status: 200,
    })

    expect(shape).toMatchObject({ t: "object", keys: { id: { t: "string" }, extra: { t: "any" } } })
  })

  it("keeps Graph's wanted paths, spreads 2XX answers and merges inherited properties", () => {
    const yaml = `
openapi: 3.0.4
paths:
  /me:
    get:
      responses:
        2XX:
          $ref: '#/components/responses/user'
  /unwanted:
    get:
      responses: {}
components:
  responses:
    user:
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/microsoft.graph.user'
  schemas:
    microsoft.graph.entity:
      type: object
      required: ['@odata.type']
      properties:
        id:
          type: string
    microsoft.graph.user:
      allOf:
        - $ref: '#/components/schemas/microsoft.graph.entity'
        - type: object
          properties:
            mail:
              type: string
`
    const description = graphDescription(yaml, ["/me"])
    const shape = documentedShape(description, { operation: "GET /v1.0/me", status: 200 })

    expect(Object.keys(description.paths)).toEqual(["/v1.0/me"])
    expect(shape).toMatchObject({
      t: "object",
      keys: { id: { t: "string" }, mail: { t: "string" } },
    })
    expect(JSON.stringify(shape)).not.toContain('"required"')
  })
})
