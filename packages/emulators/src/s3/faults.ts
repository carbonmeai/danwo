const xml = (code: string, message: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${message}</Message></Error>`

/**
 * Failures an S3 call can meet, as the fault matrix injects them at the proxy: PutObject,
 * GetObject, the multipart steps and the rest alike. Status faults carry S3's error document so
 * the SDK raises the error an app would see. The AWS SDK retries 500 and 503 (three attempts by
 * default), so a single fault there checks the retry path; a reset checks the app's handling of a
 * dropped connection.
 */
export function s3OutboundFaults(call: { method: string }) {
  const headers = { "content-type": "application/xml" }
  const faults = [
    {
      kind: "status",
      status: 500,
      headers,
      body: xml("InternalError", "We encountered an internal error. Please try again."),
    },
    {
      kind: "status",
      status: 503,
      headers,
      body: xml("SlowDown", "Please reduce your request rate."),
    },
    { kind: "reset" },
  ] as const

  // A dropped response after S3 acted only matters for calls that change something.
  return call.method === "GET" || call.method === "HEAD"
    ? faults
    : ([...faults, { kind: "reset-after" }] as const)
}
