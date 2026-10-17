/**
 * The app failing while a step runs: a 5xx response from the app itself, an uncaught error on the
 * page, and (when asked) an error on the console, plus provider calls that failed at the proxy.
 * A live agent step stops at the first one instead of wandering on a broken page, and a step the
 * app failed in is never kept as a recording.
 */
import type { Page } from "playwright-core"

import { DanwoError } from "../support/codes.ts"

/** One way the app failed. */
export interface AppFailure {
  readonly kind: "response" | "page-error" | "console"
  readonly text: string
}

export interface AppErrorOptions {
  /** Count console errors as failures too (default false). */
  readonly console?: boolean
}

/** A place in the failures seen so far; what came after it is what a step caused. */
export interface FailureMark {
  readonly app: number
  readonly provider: number
}

/** Provider calls that failed at the proxy, as the environment reports them, oldest first. */
export type ProviderFailures = () => readonly string[]

/** Watches the app's pages for failures. */
export class AppErrors {
  private readonly origin: string
  private readonly options: AppErrorOptions
  private readonly providers: ProviderFailures | undefined
  private readonly seen: AppFailure[] = []

  constructor(appUrl: string, options: AppErrorOptions = {}, providers?: ProviderFailures) {
    this.origin = new URL(appUrl).origin
    this.options = options
    this.providers = providers
  }

  /** Starts watching `page`. */
  watch(page: Page): void {
    page.on("response", (response) => {
      const url = response.url()

      if (response.status() >= 500 && url.startsWith(this.origin))
        this.seen.push({ kind: "response", text: `${response.status()} from ${url}` })
    })
    page.on("pageerror", (error) => this.seen.push({ kind: "page-error", text: error.message }))
    page.on("console", (message) => {
      if (this.options.console === true && message.type() === "error")
        this.seen.push({ kind: "console", text: message.text() })
    })
  }

  mark(): FailureMark {
    return { app: this.seen.length, provider: this.providers?.().length ?? 0 }
  }

  /** What failed since `mark`, or undefined when nothing did. */
  since(mark: FailureMark): DanwoError | undefined {
    const app = this.seen.slice(mark.app)

    if (app.length === 0) return undefined

    const provider = this.providers?.().slice(mark.provider) ?? []
    const first = app[0]?.text ?? ""

    return provider.length > 0
      ? new DanwoError(
          "PROVIDER_ERROR",
          `a provider call failed (${provider[0] ?? ""}) and the app then failed: ${first}`,
        )
      : new DanwoError("APP_ERROR", `the app failed: ${first}`)
  }

  /** Every failure seen since `mark`, for the step's record. */
  failures(mark: FailureMark): readonly AppFailure[] {
    return this.seen.slice(mark.app)
  }
}
