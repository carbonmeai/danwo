/** Every request goes through Clerk's middleware first, so pages and server functions know who is signed in. */
import { clerkMiddleware } from "@clerk/tanstack-react-start/server"
import { createStart } from "@tanstack/react-start"

export const startInstance = createStart(() => ({ requestMiddleware: [clerkMiddleware()] }))
