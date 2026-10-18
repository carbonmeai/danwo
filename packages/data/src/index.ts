/**
 * Ready-made `snapshot()` and `restore()` for the app's own data stores, so `danwo matrix` can
 * start every trial from the same state in milliseconds instead of resetting the app.
 */
export {
  type DatabaseSnapshot,
  postgresSnapshot,
  type PostgresRestoreStrategy,
  type PostgresSnapshotOptions,
  postgresWorkerDatabase,
  type WorkerDatabaseOptions,
} from "./postgres.ts"
export { redisSnapshot, type RedisSnapshotOptions } from "./redis.ts"
export { sqliteSnapshot, type SqliteSnapshotOptions, sqliteWorkerFile } from "./sqlite.ts"
