/**
 * The site's environment, read when the server starts: where the studio's API answers, from the
 * site's server and from the browser. A deployment would give the server an internal address and
 * the browser a public one; here they are the same.
 */
import { defineEnvVars } from "@sveltejs/kit/env"

/**
 * An absolute http(s) URL, without a trailing slash; a bad one fails the start. The build checks
 * the variables too, where they are unset, so a missing one is left for the first call to name.
 */
function url(name: string) {
  return (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined
    if (!/^https?:\/\//.test(value)) throw new Error(`${name} must be an http(s) URL`)

    return value.replace(/\/$/, "")
  }
}

export const variables = defineEnvVars({
  API_URL: {
    description: "The studio's API, as the site's server calls it.",
    schema: url("API_URL"),
  },
  PUBLIC_API_URL: {
    public: true,
    description: "The studio's API, as the browser calls it.",
    schema: url("PUBLIC_API_URL"),
  },
})
