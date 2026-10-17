/** The app as a test sees it. */
export interface App {
  /** The app's base URL, as the session was given it. */
  readonly baseUrl: string
  /** Opens `path` resolved against the base URL, or the base URL itself. */
  open(path?: string): Promise<void>
}
