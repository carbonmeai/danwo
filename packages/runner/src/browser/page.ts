/** The app as a test sees it. */
export interface App {
  /** The app's base URL, as the session was given it. */
  readonly baseUrl: string
  /** Opens `path` resolved against the base URL, or the base URL itself. */
  open(path?: string): Promise<void>
  /**
   * The active tab's address now, in full (`http://localhost:3000/orders/7?tab=items`). It reads
   * once and does not wait: to wait for a navigation, `expect(screen).toHaveURL(…)`. A device app
   * has no address, so on a device it throws `CONFIG_INVALID`.
   */
  url(): string
  /**
   * The text on the clipboard, as the active tab reads it: what a copy button put there. Chromium
   * only, with `browser.contextOptions.permissions: ["clipboard-read", "clipboard-write"]`;
   * otherwise, and on a device, it rejects with `CONFIG_INVALID`.
   */
  clipboard(): Promise<string>
}
