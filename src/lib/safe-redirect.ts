/**
 * Where to send someone after sign-in, given the raw `callbackUrl` query value.
 * Only a same-origin path is honoured; anything else (an absolute URL, a
 * protocol-relative `//host`, a backslash the browser would read as a slash, a
 * control character, a `javascript:` scheme) falls back to `fallback`. Without
 * this a link like `/login?callbackUrl=https://phish.example/` sends a nurse
 * from the real sign-in page to a lookalike one.
 */
export function safeCallbackPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  // Browsers treat "\" like "/" ("/\evil.example" is protocol-relative) and
  // strip tabs/newlines while parsing, so refuse both outright.
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}
