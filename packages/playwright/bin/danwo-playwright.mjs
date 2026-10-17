#!/usr/bin/env node
/**
 * The `danwo-playwright` command. Plain JavaScript, so an installed danwo can strip the types of
 * its own TypeScript source before loading any of it.
 */
import "@danwo/runner/strip-types"

await import("../src/bin.ts")
