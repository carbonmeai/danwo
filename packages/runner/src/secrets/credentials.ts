/**
 * Credentials recognisable by their shape alone, wherever they appear in text: provider API keys
 * and signing secrets, bearer and basic credentials, AWS keys and signatures, OAuth codes and
 * tokens, Auth0 tickets, Slack and GitHub tokens, Flutterwave keys, PEM private keys, and URLs that work as bearer tokens (upload
 * sessions, pre-authenticated downloads, Slack webhook and response URLs).
 * Values a session was given are redacted by its vault; these catch the ones it never was.
 */

/** What a redacted credential becomes. */
export const REDACTED = "[redacted]"

/** Each shape, and what keeps a hint of which credential it was (`sk_test_[redacted]`). */
const TOKEN_PATTERNS: readonly [RegExp, string][] = [
  /* Stripe's secret, restricted and publishable keys; Bachs's sandbox keys. */
  [/\b((?:sk|rk|pk)_(?:test|live)_|sk_sandbox_)[A-Za-z0-9]+/g, `$1${REDACTED}`],
  [/\b(whsec_)[A-Za-z0-9+/=_-]+/g, `$1${REDACTED}`],
  [/\b(re_)[A-Za-z0-9_]{8,}/g, `$1${REDACTED}`],
  [/(_secret_)[A-Za-z0-9]+/g, `$1${REDACTED}`],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`],
  [/\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, `$1${REDACTED}`],
  [/(AWS4-HMAC-SHA256 Credential=)[^,\s]+/g, `$1${REDACTED}`],
  [/([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s"']+/gi, `$1${REDACTED}`],
  /*
   * OAuth: codes and tokens in redirects, callback URLs and fragments; JWTs (ID tokens) anywhere;
   * Google's access (`ya29.`) and refresh (`1//`) tokens, Microsoft's (`EwA`, `1.A`).
   */
  [
    /([?&#](?:code|code_verifier|access_token|id_token|refresh_token|client_secret|session_state)=)[^&#\s"']+/gi,
    `$1${REDACTED}`,
  ],
  [/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED],
  [/\b(ya29\.)[A-Za-z0-9._-]+/g, `$1${REDACTED}`],
  [/(^|[^A-Za-z0-9])(1\/\/)[A-Za-z0-9._-]+/g, `$1$2${REDACTED}`],
  [/\b(EwA|1\.A)[A-Za-z0-9_-]{20,}/g, `$1${REDACTED}`],
  /*
   * URLs whose path or query alone grants access: Graph upload sessions and download links,
   * Google resumable upload sessions.
   */
  [/(graph\.microsoft\.com\/(?:up|download)\/)[^\s"'?#/]+/g, `$1${REDACTED}`],
  [/(hooks\.slack\.com\/)[^\s"'?#]+/g, `$1${REDACTED}`],
  /* Auth0's verification and password-change tickets, and the ID token a logout link carries. */
  [
    /(\/u\/(?:email-verification|reset-verify|password-reset)\?(?:[^#\s"']*&)?ticket=)[^&#\s"']+/g,
    `$1${REDACTED}`,
  ],
  [/([?&]id_token_hint=)[^&#\s"']+/g, `$1${REDACTED}`],
  /* Bachs portal session URLs sign the customer in; recovery links let anyone replace the card. */
  [/((?:portal\.bachs\.io\/s|checkout\.bachs\.io\/recover)\/)[^\s"'?#/]+/g, `$1${REDACTED}`],
  /* Slack bot, user, refresh and app tokens; GitHub's OAuth, App, refresh and personal tokens. */
  [/\b(xox[abpe]-|xoxe\.xox[bp]-|xapp-)[A-Za-z0-9-]+/g, `$1${REDACTED}`],
  [/\b(gh[opusr]_)[A-Za-z0-9]{16,}/g, `$1${REDACTED}`],
  [/\b(github_pat_)[A-Za-z0-9_]{16,}/g, `$1${REDACTED}`],
  /* PEM private keys, raw or with their line breaks escaped inside JSON. */
  [/-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g, REDACTED],
  [/([?&]upload_id=)[^&#\s"']+/g, `$1${REDACTED}`],
  /* Flutterwave secret, public and encryption keys, test and live. */
  [/\b(FLW(?:SECK|PUBK)(?:_TEST)?-?)[A-Za-z0-9]+(?:-X)?/g, `$1${REDACTED}`],
  /* OpenAI project, service-account and legacy keys; Anthropic keys; AI Gateway keys. */
  [/\b(sk-(?:ant-[a-z]+\d*-|proj-|svcacct-|admin-)?)[A-Za-z0-9_-]{16,}/g, `$1${REDACTED}`],
  [/\b(vck_)[A-Za-z0-9_-]{8,}/g, `$1${REDACTED}`],
]

/** `text` with every credential-shaped value replaced. */
export function redactCredentials(text: string): string {
  return TOKEN_PATTERNS.reduce((out, [pattern, replace]) => out.replace(pattern, replace), text)
}
