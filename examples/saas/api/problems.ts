/** An error the API answers with its own status and message, for the web app to show. */
export class HttpError extends Error {
  override readonly name = "HttpError"
  readonly status: 400 | 401 | 403 | 404 | 409 | 502

  constructor(status: HttpError["status"], message: string) {
    super(message)
    this.status = status
  }
}
