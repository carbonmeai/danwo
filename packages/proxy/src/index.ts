// Routing proxy: provider routing, fault injection, HAR capture.
export {
  describeOutboundFault,
  EMULATE_HEADER,
  type Exchange,
  type Handler,
  hostMatches,
  type OutboundCall,
  type OutboundFault,
  type OutboundFaultRule,
  type Proxy,
  type ProxyOptions,
  type Route,
  startProxy,
} from "./proxy.ts"
export { APP_CLOCK_VARIABLE, type AppClock } from "./app-clock.ts"
export {
  type BlockedLoad,
  blockedLoads,
  blockedLoadsLine,
  isPassableAsset,
  type LoadKind,
  loadKind,
  mergeBlockedLoads,
} from "./assets.ts"
export { taggedUserAgent, USER_AGENT_TAG, userOf } from "./clients.ts"
export { type CapturedMessage, MAX_CAPTURED_BODY_BYTES } from "./capture.ts"
export { isLoopback, isPageAsset, isStreaming, TELEMETRY_HOSTS } from "./hosts.ts"
export { type EnvOptions, PRELOAD_DIR_VARIABLE } from "./node-env.ts"
export { forwardTo } from "./upstream.ts"
export {
  type SocketCall,
  type SocketExchange,
  type SocketFault,
  type SocketFaultRule,
} from "./websocket.ts"
