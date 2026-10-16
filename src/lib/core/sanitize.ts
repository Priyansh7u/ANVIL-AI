/**
 * Treat all web content as untrusted data. These helpers bound its size,
 * strip control characters, detect likely prompt-injection attempts, and
 * wrap it in clearly delimited blocks before it reaches an LLM.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts?)/i,
  /disregard (the|all|your) (instructions|rules|system prompt)/i,
  /you are now (a|an|in) /i,
  /system prompt/i,
  /\bassistant:\s/i,
  /<\/?(system|instructions?)>/i,
  /reveal (your|the) (prompt|instructions|api key)/i,
  /mark (this|all) (shelters?|locations?) as (safe|verified)/i,
];

export function detectPromptInjection(text: string): string[] {
  return INJECTION_PATTERNS.filter((re) => re.test(text)).map((re) => re.source);
}

export function stripControlChars(text: string): string {
  // keep \n and \t; remove other C0/C1 controls and bidi overrides
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, "");
}

export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[…truncated]` : text;
}

/** Wrap untrusted page text. The delimiter includes a random nonce so content cannot fake a closing tag. */
export function wrapUntrusted(text: string, sourceUrl: string, maxChars = 24_000, nonce = randomNonce()): string {
  const body = truncate(stripControlChars(text), maxChars).replaceAll(`</untrusted_${nonce}>`, "");
  return `<untrusted_${nonce} source="${sourceUrl.replace(/"/g, "%22")}">\n${body}\n</untrusted_${nonce}>`;
}

function randomNonce(): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (g.crypto?.getRandomValues) {
    const a = g.crypto.getRandomValues(new Uint8Array(6));
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(16).slice(2, 14);
}

/** Escape a user-supplied string for safe inclusion in a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
