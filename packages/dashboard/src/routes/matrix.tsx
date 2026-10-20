import { createFileRoute } from "@tanstack/react-router"

import { MatrixPage } from "../modules/tests/matrix-page.tsx"
import { fetchTests } from "../modules/tests/tests-api.ts"

export const Route = createFileRoute("/matrix")({
  loader: () => fetchTests(),
  component: () => <MatrixPage rows={Route.useLoaderData().rows} />,
})
