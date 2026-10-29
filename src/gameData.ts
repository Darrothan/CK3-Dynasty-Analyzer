import { isObject, text } from './model';

export interface GameDefinitions {
  houses: Map<string, { name: string | null; prefix: string | null }>;
  dynasties: Map<string, { name: string | null; prefix: string | null }>;
}

export const emptyDefinitions = (): GameDefinitions => ({ houses: new Map(), dynasties: new Map() });

export function selectedGameFiles<T extends { name: string; webkitRelativePath: string }>(files: T[]): T[] {
  const paths = files.map(file => (file.webkitRelativePath || file.name).replaceAll('\\', '/'));
  const wholeGame = paths.some(path => /(?:^|\/)localization\/english\//i.test(path));
  return files.filter((file, index) => {
    const path = paths[index];
    if (/(?:^|\/)common\/(?:dynasty_houses|dynasties)\/[^/]+\.txt$/i.test(path)) return true;
    if (!/\.ya?ml$/i.test(path)) return false;
    if (wholeGame) return /(?:^|\/)localization\/english\//i.test(path);
    return !/(?:^|\/)localization\/(?!english\/)[^/]+\//i.test(path);
  });
}

export function addDefinitions(definitions: GameDefinitions, path: string, value: unknown): void {
  const normalizedPath = path.replaceAll('\\', '/');
  const target = /(?:^|\/)common\/dynasty_houses\//i.test(normalizedPath) ? definitions.houses
    : /(?:^|\/)common\/dynasties\//i.test(normalizedPath) ? definitions.dynasties : null;
  if (!target || !isObject(value)) return;
  for (const [key, record] of Object.entries(value)) {
    if (!isObject(record)) continue;
    target.set(key, { name: text(record.name), prefix: text(record.prefix) });
  }
}
