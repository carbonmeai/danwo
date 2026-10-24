/**
 * The proxy says nothing about connections its clients drop, handshakes they turn down or hosts
 * that cannot be reached: browsers drop streams and sockets all the time at the end of a page, a
 * device's own services try TLS versions the proxy does not serve, and the record already holds
 * each failed call's answer. `DANWO_DEBUG=proxy` prints those lines, for chasing a connection
 * problem.
 */

/** Whether `DANWO_DEBUG` (a comma-separated list) names `topic`. */
export function debugging(topic: string, setting = process.env["DANWO_DEBUG"]): boolean {
  return (setting ?? "").split(",").some((part) => part.trim() === topic || part.trim() === "*")
}

/** Prints a line about the proxy's connections when `DANWO_DEBUG` names `proxy`, else nothing. */
export function proxyDebug(): (message: string) => void {
  return debugging("proxy") ? (message) => console.error(`danwo proxy: ${message}`) : () => {}
}
