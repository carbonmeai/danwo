import { createFileRoute } from "@tanstack/react-router"

import { fetchSettings } from "../modules/settings/settings-api.ts"
import { SettingsPage, SettingsSkeleton } from "../modules/settings/settings-page.tsx"

export const Route = createFileRoute("/settings")({
  loader: () => fetchSettings(),
  component: () => <SettingsPage settings={Route.useLoaderData()} />,
  pendingComponent: SettingsSkeleton,
})
