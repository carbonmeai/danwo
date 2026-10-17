/**
 * Time-based one-time codes: the published test values of RFC 6238, and a `totp` secret that
 * types the code of the moment while keeping both the key and the code out of every record.
 */
import { describe, expect, it } from "vitest"

import { SecretVault } from "../src/secrets/index.ts"
import { base32Bytes, totp } from "../src/secrets/totp.ts"

/** The RFC's SHA-1 key, "12345678901234567890", in base32. */
const RFC_KEY = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

describe("totp", () => {
  it("makes the RFC 6238 SHA-1 test codes", () => {
    const eight = { digits: 8 } as const

    expect(totp(RFC_KEY, eight, 59_000)).toBe("94287082")
    expect(totp(RFC_KEY, eight, 1_111_111_109_000)).toBe("07081804")
    expect(totp(RFC_KEY, eight, 1_234_567_890_000)).toBe("89005924")
    expect(totp(RFC_KEY, eight, 20_000_000_000_000)).toBe("65353130")
  })

  it("reads base32 keys with spaces, lower case and padding", () => {
    expect(base32Bytes("gezd gnbv gy3t qojq====").toString("ascii")).toBe("1234567890")
    expect(() => base32Bytes("not base32!")).toThrow(/not a base32 character/)
  })

  it("keeps the same code for one period and changes it after", () => {
    expect(totp(RFC_KEY, {}, 30_000)).toBe(totp(RFC_KEY, {}, 59_999))
    expect(totp(RFC_KEY, {}, 60_000)).not.toBe(totp(RFC_KEY, {}, 59_999))
    expect(totp(RFC_KEY, {}, 0)).toMatch(/^\d{6}$/)
  })
})

describe("a totp secret", () => {
  it("types the code of the moment and redacts both the key and the code", async () => {
    const vault = new SecretVault({ authenticator: { value: RFC_KEY, purpose: "totp" } })
    const handle = vault.handle("authenticator")
    const code = await vault.reveal(handle)

    expect(handle.purpose).toBe("totp")
    expect(code).toMatch(/^\d{6}$/)
    expect(code).toBe(totp(RFC_KEY))
    expect(vault.redact(`key ${RFC_KEY} code ${code}`)).toBe(
      "key [secret authenticator] code [secret authenticator]",
    )
  })
})
