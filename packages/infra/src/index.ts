/** Fault proxies in front of the app's own data stores, for `danwo matrix`. */
export {
  defaultDataFaults,
  describeDataFault,
  pgError,
  POSTGRES_ERRORS,
  REDIS_ERRORS,
  redisError,
} from "./faults.ts"
export { type PostgresProxyOptions, startPostgresProxy } from "./postgres/index.ts"
export { classify as classifySql, operationOf } from "./postgres/sql.ts"
export { type RedisProxyOptions, startRedisProxy } from "./redis/index.ts"
export { classifyCommand, foldKey } from "./redis/commands.ts"
export type { Upstream } from "./tcp.ts"
export type {
  DataCall,
  DataCallStart,
  DataFault,
  DataFaultRule,
  DataKind,
  DataProxy,
  DataRole,
} from "./types.ts"
