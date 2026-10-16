/**
 * Minimal, dependency-free XML helpers for well-formed RSS 2.0 and
 * OASIS CAP 1.2 documents. Not a general XML parser: it extracts the text
 * content of named elements (namespace prefix optional). CAP/RSS do not
 * nest same-named elements, which is what makes this approach safe here.
 */

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITY_MAP[body] ?? match;
  });
}

function unwrapCdata(input: string): string {
  return input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns the raw inner XML of every element with the given local name. */
export function findAllElements(xml: string, localName: string): string[] {
  const name = escapeRegex(localName);
  const re = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>)`,
    "g",
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1] ?? "");
  }
  return out;
}

/** Text content (CDATA unwrapped, entities decoded, trimmed) of the first matching element, or null. */
export function textOf(xml: string, localName: string): string | null {
  const [first] = findAllElements(xml, localName);
  if (first === undefined) return null;
  const text = decodeEntities(unwrapCdata(first)).replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

export function textsOf(xml: string, localName: string): string[] {
  return findAllElements(xml, localName)
    .map((raw) => decodeEntities(unwrapCdata(raw)).replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 0);
}
