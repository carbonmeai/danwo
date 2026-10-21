/**
 * The danwo build of an iOS app: App Transport Security lets the app make plain HTTP calls, which
 * tests route through the proxy to the app's own backend (`http://shop.danwo.test`). HTTPS needs
 * nothing here: danwo trusts its CA in the simulator itself. A store build never gets this.
 */
import { execFile } from "node:child_process"

/**
 * The App Transport Security settings of the danwo build: arbitrary loads alone, because iOS
 * ignores `NSAllowsArbitraryLoads` when a finer key such as `NSAllowsLocalNetworking` is present.
 */
export const DANWO_TRANSPORT_SECURITY = { NSAllowsArbitraryLoads: true } as const

/** Sets the danwo build's App Transport Security in the app's `Info.plist`, replacing what was there. */
export function applyIosNetworkConfig(infoPlist: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "plutil",
      [
        "-replace",
        "NSAppTransportSecurity",
        "-json",
        JSON.stringify(DANWO_TRANSPORT_SECURITY),
        infoPlist,
      ],
      (error, _stdout, stderr) => {
        if (error)
          reject(new Error(`plutil could not edit ${infoPlist}: ${stderr || error.message}`))
        else resolve()
      },
    )
  })
}
