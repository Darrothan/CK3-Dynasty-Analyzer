import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Jomini } from 'jomini';
import { extractGamestate } from './import';
import { normalize } from './model';

const path = process.env.CK3_INTEGRATION_SAVE;
describe.skipIf(!path)('local real-save integration', () => {
  it('extracts, parses and resolves real character records', async () => {
    const bytes = extractGamestate(await readFile(path!));
    const parser = await Jomini.initialize();
    const result = parser.parseText(bytes, { typeNarrowing: 'none' }, query => {
      const source: Record<string, unknown> = {};
      for (const key of ['date', 'meta_data', 'living', 'dead_unprunable', 'dynasties', 'culture_manager', 'traits_lookup', 'faiths', 'rites', 'religion']) source[key] = query.at(`/${key}`);
      source.landed_titles = { landed_titles: query.at('/landed_titles/landed_titles') };
      return normalize(source);
    });
    expect(result.tables.characters.length).toBeGreaterThan(0);
    expect(result.tables.dynasties.length).toBeGreaterThan(0);
    expect(result.tables.houses.length).toBeGreaterThan(0);
    expect(result.tables.characters.some(c => c.faith_id !== null && c.faith !== null)).toBe(true);
    expect(result.tables.titles.some(t => t.holder_id != null)).toBe(true);
    const resolved = result.tables.characters.find(c => c.house_id != null && c.dynasty_id != null);
    expect(resolved).toBeDefined();
    expect(result.tables.houses.some(h => h.id === resolved?.house_id && h.dynasty_id === resolved.dynasty_id)).toBe(true);
    expect(new Set(result.tables.characters.map(c => c.id)).size).toBe(result.tables.characters.length);
    console.log(`Validated ${result.tables.characters.length} unique characters, ${result.tables.houses.length} houses, ${result.tables.dynasties.length} dynasties.`);
  }, 120000);
});
