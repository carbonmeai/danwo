/**
 * The dashboard's request handling: anything but a read must come from the dashboard's own pages,
 * so another site open in the browser cannot start or stop runs on this machine.
 */
import { createCsrfMiddleware, createStart } from "@tanstack/react-start"

const READS = new Set(["GET", "HEAD", "OPTIONS"])

export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({ filter: ({ request }) => !READS.has(request.method) }),
  ],
}))
