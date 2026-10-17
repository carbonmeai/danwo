/*
 * `expect`: locators get the waiting checks in matchers.ts; any other value gets Jest-style
 * matchers from @vitest/expect, which reads like the test files' own vitest assertions.
 */
import {
  type Assertion,
  chai,
  JestAsymmetricMatchers,
  JestChaiExpect,
  JestExtend,
} from "@vitest/expect"

import { ElementLocator, PageScreen } from "../locate/locator.ts"
import type { Locator, Screen } from "../locate/types.ts"
import { type LocatorAssertions, locatorAssertions, pictureOptions } from "./matchers.ts"
import { screenshotCheck, type VisualOptions } from "./visual.ts"

/*
 * Install the matchers once per process. Under vitest (danwo's own tests) chai already has them,
 * and installing them again would replace vitest's `rejects` and `toThrow` with weaker ones.
 */
if (!("toBe" in chai.Assertion.prototype)) {
  chai.use(JestExtend)
  chai.use(JestChaiExpect)
  chai.use(JestAsymmetricMatchers)
}

/** What `expect(screen)` offers: checks of the whole page. */
export interface PageAssertions {
  /** The visible page looks like its baseline image; see the locator check of the same name. */
  toHaveScreenshot(name?: string, options?: VisualOptions): Promise<void>
}

/** `expect(locator)` waits for the page; `expect(screen)` checks the page; `expect(value)` a value. */
export interface Expect {
  (actual: Locator): LocatorAssertions
  (actual: Screen): PageAssertions
  <T>(actual: T): Assertion<void, T>
}

/** Checks of the page the screen shows. */
function pageAssertions(screen: PageScreen): PageAssertions {
  const context = screen.session

  return {
    toHaveScreenshot: (name, options) =>
      screenshotCheck(
        context,
        {
          text: "page",
          take: (taking) =>
            context.page().screenshot({ ...pictureOptions(taking), mask: [...taking.mask] }),
        },
        name,
        options,
      ),
  }
}

/** Jest-style matchers on a plain value. */
function expectValue<T>(actual: T): Assertion<void, T> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- @vitest/expect's plugins add the Jest matchers to chai's assertion at runtime, which chai's types don't know
  return chai.expect(actual) as unknown as Assertion<void, T>
}

/** The `expect` of danwo tests. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one runtime function serves every overload of Expect, which picks the assertions by the argument's type
export const expect = ((actual: unknown) => {
  if (actual instanceof ElementLocator) return locatorAssertions(actual)
  if (actual instanceof PageScreen) return pageAssertions(actual)

  return expectValue(actual)
}) as Expect
