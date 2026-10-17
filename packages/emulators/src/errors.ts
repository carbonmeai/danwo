import type { Context, ErrorHandler } from "./http.ts"

/** An error a handler throws to answer with a specific status. */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}

/**
 * An error hook that answers in the provider's own error format: `HttpError`s keep their status,
 * anything else is a 500.
 */
export function providerErrors(
  respond: (c: Context, status: number, message: string) => Response,
): ErrorHandler {
  return (error, c) => {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : "Internal server error"

    return respond(c, status, message)
  }
}
