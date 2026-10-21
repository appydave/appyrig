/**
 * Text extractors for OpenRig source. Each one finds a NAMED anchor (a const, a Map, an interface,
 * a function, a doc heading) and returns the string literals inside it, in source order. An anchor
 * that is not found returns null: the caller reports that as drift (OpenRig renamed or moved it),
 * never as an empty set.
 *
 * Deliberately regex over text, not a TypeScript parse: the anchors are plain literal lists, and the
 * check must run against any commit without installing OpenRig's dependencies.
 */

const STRING = /"([^"\\]+)"|'([^'\\]+)'/g;

function strings(text: string): string[] {
  return [...text.matchAll(STRING)].map((m) => m[1] ?? m[2] ?? '');
}

/** From `open` (the index of an opening bracket) to its matching close bracket. */
function balanced(text: string, open: number): string | null {
  const pair: Record<string, string> = { '[': ']', '{': '}', '(': ')' };
  const first = text[open];
  if (!first || !pair[first]) {
    return null;
  }
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '[' || c === '{' || c === '(') {
      depth++;
    } else if (c === ']' || c === '}' || c === ')') {
      depth--;
    }
    if (depth === 0) {
      return text.slice(open + 1, i);
    }
  }

  return null;
}

/** `const NAME = new Set([...])`, `const NAME: T = new Set([...])` or `const NAME = [...] as const`. */
export function constList(text: string, name: string): string[] | null {
  const m = new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*(?:new Set(?:<[^>]*>)?\\(\\s*)?\\[`).exec(
    text
  );
  if (!m) {
    return null;
  }
  const body = balanced(text, m.index + m[0].length - 1);

  return body === null ? null : strings(body);
}

/** `const NAME = new Map([["key", ...], ...])`: the keys. */
export function mapKeys(text: string, name: string): string[] | null {
  const m = new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*new Map(?:<[^>]*>)?\\(\\s*\\[`).exec(text);
  if (!m) {
    return null;
  }
  const body = balanced(text, m.index + m[0].length - 1);
  if (body === null) {
    return null;
  }

  return [...body.matchAll(/\[\s*"([^"]+)"/g)].map((x) => x[1] ?? '');
}

/** `interface NAME { a: …; b?: … }`: the field names, in order. */
export function interfaceFields(text: string, name: string): string[] | null {
  const m = new RegExp(`\\binterface\\s+${name}\\b[^{]*\\{`).exec(text);
  if (!m) {
    return null;
  }
  const body = balanced(text, m.index + m[0].length - 1);
  if (body === null) {
    return null;
  }

  return [...body.matchAll(/^\s*(\w+)\??\s*:/gm)].map((x) => x[1] ?? '');
}

/** `type NAME = "a" | "b";`: the literals. */
export function unionLiterals(text: string, name: string): string[] | null {
  const m = new RegExp(`\\btype\\s+${name}\\s*=([^;]+);`).exec(text);

  return m ? strings(m[1] ?? '') : null;
}

/** `const NAME = "value"`. */
export function stringConst(text: string, name: string): string | null {
  const m = new RegExp(`\\bconst\\s+${name}\\b[^=]*=\\s*["']([^"']+)["']`).exec(text);

  return m ? (m[1] ?? null) : null;
}

/**
 * Every `<variable>["key"]` (or `<variable>?.["key"]`) read inside `function fnName(...)`. This is
 * how OpenRig's normalisers read authored YAML keys, so it is the list of keys OpenRig consumes.
 */
export function functionKeys(text: string, fnName: string, variable: string): string[] | null {
  const m = new RegExp(`\\bfunction\\s+${fnName}\\s*\\(`).exec(text);
  if (!m) {
    return null;
  }
  const brace = text.indexOf('{', text.indexOf(')', m.index));
  const body = balanced(text, brace);
  if (body === null) {
    return null;
  }
  const re = new RegExp(`\\b${variable}(?:\\?\\.)?\\["([a-z_]+)"\\]`, 'g');

  return unique([...body.matchAll(re)].map((x) => x[1] ?? ''));
}

/** The `UPPER.md` names written in backticks between two markers of a Markdown doc. */
export function docMdNames(text: string, from: string, to: string): string[] | null {
  const a = text.indexOf(from);
  if (a < 0) {
    return null;
  }
  const b = text.indexOf(to, a + from.length);
  if (b < 0) {
    return null;
  }
  const slice = text.slice(a, b);

  return unique([...slice.matchAll(/`([A-Z][A-Z0-9_-]*\.md)`/g)].map((x) => x[1] ?? ''));
}

export function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
