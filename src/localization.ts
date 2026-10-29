export interface LocalizationFile {
  path: string;
  content: string;
}

export interface Localization {
  resolve(value: string | null): string | null;
  lookup(key: string): string | null;
  collisions: number;
  entries: number;
}

export function normalizeSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
}

// Files are ordered by their relative paths; the last definition wins.
export function createLocalization(files: LocalizationFile[]): Localization {
  const entries = new Map<string, string>();
  let collisions = 0;
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    for (const line of file.content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const match = line.match(/^\s*([^\s:#]+)\s*:\s*\d*\s*"((?:\\.|[^"\\])*)"/);
      if (!match) continue;
      const value = match[2].replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n');
      if (entries.has(match[1]) && entries.get(match[1]) !== value) collisions++;
      entries.set(match[1], value);
    }
  }
  const cache = new Map<string, string | null>();
  function lookup(key: string, stack: Set<string>): string | null {
    if (cache.has(key)) return cache.get(key) ?? null;
    const raw = entries.get(key);
    if (raw === undefined || stack.has(key)) return null;
    const next = new Set(stack).add(key);
    let unresolved = false;
    const value = raw.replace(/\$([^$]+)\$/g, (_match, reference: string) => {
      const resolved = lookup(reference, next);
      if (resolved === null) { unresolved = true; return ''; }
      return resolved;
    }).replace(/#[A-Za-z][A-Za-z0-9_]*(?:\s+|$)/g, '').replace(/#!/g, '');
    const result = unresolved || !value.trim() || /[\[\]$]|\\[nrt]/.test(value) ? null : value;
    // A cyclic lookup depends on its call stack, so do not cache failures.
    if (result !== null) cache.set(key, result);
    return result;
  }
  return {
    collisions,
    entries: entries.size,
    lookup(key) { return lookup(key, new Set()); },
    resolve(value) {
      if (value === null || !value.trim()) return null;
      return lookup(value, new Set()) ?? value;
    },
  };
}
