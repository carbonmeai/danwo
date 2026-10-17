import type { StripeRouteContext } from "../context.ts"
import type { DisplayPreference, PaymentMethodConfiguration } from "../entities.ts"
import { CONFIGURABLE_METHODS, paymentMethodConfigurationObject } from "../formatters.ts"
import { asRecord, badParam, flag, listPage, newId, noSuch, readParams, text } from "../helpers.ts"

const PREFERENCES: readonly string[] = ["on", "off", "none"]

/** The `<method>[display_preference][preference]` values a request sets. */
function requestedPreferences(params: Record<string, unknown>): Record<string, DisplayPreference> {
  const wanted: Record<string, DisplayPreference> = {}

  for (const method of Object.keys(CONFIGURABLE_METHODS)) {
    const value = text(asRecord(asRecord(params[method])?.display_preference)?.preference)

    if (value && PREFERENCES.includes(value)) wanted[method] = value as DisplayPreference
  }

  return wanted
}

/** A configuration's current preference for each method. */
function preferencesOf(
  configuration: PaymentMethodConfiguration,
): Record<string, DisplayPreference> {
  const current: Record<string, DisplayPreference> = {}
  const fields = configuration as unknown as Record<string, unknown>

  for (const method of Object.keys(CONFIGURABLE_METHODS)) {
    const value = text(asRecord(asRecord(fields[method])?.display_preference)?.preference)

    if (value && PREFERENCES.includes(value)) current[method] = value as DisplayPreference
  }

  return current
}

/** Payment method configurations: which methods Checkout offers. */
export function paymentMethodConfigurationRoutes({ app, objects }: StripeRouteContext): void {
  const configurations = objects.paymentMethodConfigurations

  app.get("/v1/payment_method_configurations", (c) =>
    listPage(c, configurations.all(), "/v1/payment_method_configurations"),
  )

  app.post("/v1/payment_method_configurations", async (c) => {
    const params = await readParams(c)
    const configuration = paymentMethodConfigurationObject({
      id: newId("pmc"),
      name: text(params.name) ?? "Unnamed configuration",
      active: true,
      isDefault: false,
      preferences: requestedPreferences(params),
    })

    return c.json(configurations.add(configuration, null))
  })

  app.get("/v1/payment_method_configurations/:id", (c) => {
    const id = c.req.param("id")
    const configuration = configurations.get(id)

    return configuration ? c.json(configuration) : noSuch(c, "payment method configuration", id)
  })

  app.post("/v1/payment_method_configurations/:id", async (c) => {
    const id = c.req.param("id")
    const current = configurations.get(id)

    if (!current) return noSuch(c, "payment method configuration", id)

    const params = await readParams(c)
    const name = text(params.name)

    if (name === "") return badParam(c, "name", "Name cannot be empty.")

    const rebuilt = paymentMethodConfigurationObject({
      id,
      name: name ?? current.name,
      active: flag(params.active) ?? current.active,
      isDefault: current.is_default,
      preferences: { ...preferencesOf(current), ...requestedPreferences(params) },
    })

    return c.json(configurations.change(id, rebuilt))
  })
}
