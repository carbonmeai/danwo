import { describe, expect, it } from "vitest"

import { isS3Host } from "../src/s3/index.ts"

/** How long `run` takes, in milliseconds. */
function timed(run: () => unknown): number {
  const started = performance.now()

  run()

  return performance.now() - started
}

describe("recognising an S3 host", () => {
  it("knows AWS's endpoint spellings", () => {
    expect(isS3Host("s3.amazonaws.com")).toBe(true)
    expect(isS3Host("media.s3.eu-west-1.amazonaws.com")).toBe(true)
    expect(isS3Host("s3-us-west-2.amazonaws.com")).toBe(true)
    expect(isS3Host("s3.dualstack.us-east-1.amazonaws.com")).toBe(true)
    expect(isS3Host("sqs.us-east-1.amazonaws.com")).toBe(false)
  })

  it("answers at once for a host built to backtrack", () => {
    expect(timed(() => isS3Host(`s3-${"-".repeat(50)}x`))).toBeLessThan(100)
    expect(timed(() => isS3Host(`s3${"--".repeat(50_000)}`))).toBeLessThan(500)
    expect(timed(() => isS3Host(`${"s3.".repeat(50_000)}amazonaws.com`))).toBeLessThan(500)
    expect(timed(() => isS3Host(`${"s3-.".repeat(50_000)}amazonaws.com`))).toBeLessThan(500)
  })

  it("finds the endpoint behind a bucket name AWS would refuse as a label", () => {
    expect(isS3Host("my_bucket.s3.amazonaws.com")).toBe(true)
    expect(isS3Host("s3-.amazonaws.com")).toBe(false)
    expect(isS3Host("amazonaws.com")).toBe(false)
  })
})
