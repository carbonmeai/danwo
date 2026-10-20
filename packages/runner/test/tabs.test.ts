import { EventEmitter } from "node:events"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BrowserContext, Page } from "playwright-core"
import { describe, expect, it } from "vitest"

import { Tabs } from "../src/browser/tabs.ts"
import { TabFilm, webHost } from "../src/browser/video.ts"
import { StepRecorder } from "../src/record/index.ts"

/** A page that answers what the tabs and the film ask of it, opened by `opener`. */
class FakePage extends EventEmitter {
  closed = false
  readonly frame = { url: () => this.address }
  private address: string
  private readonly from: FakePage | undefined

  constructor(address: string, from?: FakePage) {
    super()
    this.address = address
    this.from = from
  }

  url = () => this.address
  isClosed = () => this.closed
  mainFrame = () => this.frame
  opener = () => Promise.resolve(this.from ?? null)
  /** A video whose file is "saved" nowhere, so the film lists the tab. */
  video = () => ({ saveAs: () => Promise.resolve() })

  /** Goes to `address`, as the app's script would. */
  go(address: string): void {
    this.address = address
    this.emit("framenavigated", this.frame)
  }

  close(): void {
    this.closed = true
    this.emit("close")
  }
}

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the tabs read only page events
const asPage = (page: FakePage) => page as unknown as Page

/** A browser of one tab, with its tabs, film and step recorder wired as a session wires them. */
function browser() {
  const context = new EventEmitter()
  const first = new FakePage("http://app.test/")
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test double: the tabs hear only `page`
  const tabs = new Tabs(context as unknown as BrowserContext, asPage(first))
  const film = new TabFilm(join(tmpdir(), "danwo-tabs-nowhere"))
  const steps = new StepRecorder({ projectRoot: process.cwd(), redact: (text) => text })

  tabs.onEveryPage((page) => film.watch(page))
  steps.followTabs(() => tabs.activeNumber)

  return {
    first,
    tabs,
    film,
    steps,
    open: (page: FakePage) => context.emit("page", asPage(page)),
    act: (label: string) => steps.run("locator", "locator.click", label, () => Promise.resolve()),
  }
}

describe("tab attribution", () => {
  it("records the tab each step ran in, following a popup and back once it closes", async () => {
    const { first, tabs, steps, open, act } = browser()

    await act("Connect")

    const popup = new FakePage("about:blank", first)

    open(popup)
    await act("Email")
    await act("Allow")
    popup.close()
    await act("Connected")
    await steps.run("check", "expect.toBe", "connected", () => Promise.resolve())

    expect(steps.all().map((step) => [step.label, step.tab])).toEqual([
      ["Connect", 1],
      ["Email", 2],
      ["Allow", 2],
      ["Connected", 1],
      ["connected", undefined],
    ])
    expect(tabs.numberOf(asPage(popup))).toBe(2)
    expect(tabs.numberOf(asPage(new FakePage("http://elsewhere.test/")))).toBeUndefined()
  })

  it("moves a step to the tab it found its element in, and leaves finished steps alone", async () => {
    const { steps, act } = browser()

    await steps.run("assertion", "expect.toBeVisible", "Connect your account", () => {
      /* The popup became active while the check was looking. */
      steps.ranIn(2)

      return Promise.resolve()
    })
    steps.ranIn(3)
    await act("Email")

    expect(steps.all().map((step) => step.tab)).toEqual([2, 1])
  })

  it("numbers the steps of another person's browser by their own tabs", async () => {
    const steps = new StepRecorder({ projectRoot: process.cwd(), redact: (text) => text })
    const bob = steps.forUser("bob")

    steps.followTabs(() => 2)
    bob.followTabs(() => 1)
    await steps.run("app", "app.open", "/", () => Promise.resolve())
    await bob.run("app", "app.open", "/inbox", () => Promise.resolve())

    expect(steps.all().map((step) => [step.user, step.tab])).toEqual([
      [undefined, 2],
      ["bob", 1],
    ])
  })

  it("keeps who opened each tab, the host of the first web page it showed and whether it closed", async () => {
    const { first, film, open } = browser()
    const popup = new FakePage("about:blank", first)

    open(popup)
    popup.go("about:blank#loading")
    popup.go("https://accounts.provider.test/connect?client=app")
    popup.go("http://app.test/callback")
    popup.close()
    await film.save(Date.now())

    expect(
      film
        .videos()
        .map(({ file, tab, opener, host, closed }) => ({ file, tab, opener, host, closed })),
    ).toEqual([
      { file: "video/tab-1.webm", tab: 1, opener: undefined, host: "app.test", closed: undefined },
      { file: "video/tab-2.webm", tab: 2, opener: 1, host: "accounts.provider.test", closed: true },
    ])
  })

  it("names the host of web pages only", () => {
    expect(webHost("https://accounts.provider.test:8443/x")).toBe("accounts.provider.test:8443")
    expect(webHost("about:blank")).toBeUndefined()
    expect(webHost("data:text/html,hi")).toBeUndefined()
    expect(webHost("not a url")).toBeUndefined()
  })
})
