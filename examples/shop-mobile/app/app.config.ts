/*
 * The shop app's Expo config. `danwo build-android` builds it with DANWO=1, which adds the network
 * security config that lets the app trust danwo's per-run CA (see @danwo/expo); a store build
 * leaves it out.
 */
import type { ConfigContext, ExpoConfig } from "expo/config"

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Danwo Shop",
  slug: "danwo-shop-mobile",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "light",
  scheme: "danwoshop",
  android: { ...config.android, package: "com.danwo.shopmobile" },
  plugins: ["expo-web-browser"],
})
