import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Jomini } from 'jomini';
import * as duck from '@duckdb/duckdb-wasm/blocking';
import { extractGamestate } from './import';
import { normalize, type Row } from './model';
import { createLocalization } from './localization';
import { analyticalQuerySql, type CohortFilters } from './analytics';
import { addDefinitions, emptyDefinitions } from './gameData';

const path = process.env.CK3_INTEGRATION_SAVE;
describe.skipIf(!path)('local real-save integration', () => {
  it('extracts, parses and resolves real character records', async () => {
    const bytes = extractGamestate(await readFile(path!));
    const parser = await Jomini.initialize();
    let maleId: string | null = null;
    const result = parser.parseText(bytes, { typeNarrowing: 'none' }, query => {
      const source: Record<string, unknown> = {};
      for (const key of ['date', 'meta_data', 'living', 'dead_unprunable', 'dynasties', 'culture_manager', 'traits_lookup', 'faiths', 'rites', 'religion']) source[key] = query.at(`/${key}`);
      if (source.living && typeof source.living === 'object' && !Array.isArray(source.living)) {
        for (const [id, value] of Object.entries(source.living)) {
          const record = Array.isArray(value) ? value[0] : value;
          if (record && typeof record === 'object' && record.first_name && record.birth && !Object.hasOwn(record, 'female')) { maleId = id; break; }
        }
      }
      source.landed_titles = { landed_titles: query.at('/landed_titles/landed_titles') };
      return normalize(source);
    });

    expect(result.tables.characters.length).toBeGreaterThan(0);
    expect(result.tables.dynasties.length).toBeGreaterThan(0);
    expect(result.tables.houses.length).toBeGreaterThan(0);
    expect(result.tables.characters.some(c => c.faith_id !== null && c.faith !== null)).toBe(true);
    expect(result.tables.titles.some(t => t.holder_id != null)).toBe(true);
    for (const rite of result.tables.rites.filter(r => r.name_source != null)) {
      expect(rite.name).toBe(rite.name_source);
    }
    const resolved = result.tables.characters.find(c => c.house_id != null && c.dynasty_id != null);
    expect(resolved).toBeDefined();
    expect(result.tables.houses.some(h => h.id === resolved?.house_id && h.dynasty_id === resolved.dynasty_id)).toBe(true);
    expect(new Set(result.tables.characters.map(c => c.id)).size).toBe(result.tables.characters.length);
    if (maleId !== null) expect(result.tables.characters.find(c => c.id === maleId)?.sex).toBe('Male');
    for (const house of result.tables.houses.filter(h => h.localized_name != null)) {
      expect(house.name).toBe(house.localized_name);
    }

    const sample = result.tables.characters.slice(0, 2000);
    const ids = new Set(sample.map(c => String(c.id)));
    const dynastyId = sample.find(c => c.dynasty_id != null)?.dynasty_id;
    expect(dynastyId).toBeDefined();
    expect(dynastyId).not.toBeNull();
    const filters: CohortFilters = { dynastyId: String(dynastyId), houseId: '', status: 'Both', sex: 'All' };
    const inputs: Record<string, { rows: Row[]; columns: string[]; numeric?: string[] }> = {
      character_analytics: { rows: sample, columns: ['id', 'house_id', 'dynasty_id', 'status', 'sex', 'ruler_status', 'age', 'birth', 'birth_key', 'death_key', 'snapshot_date_key', 'date_consistency'], numeric: ['age', 'birth_key', 'death_key', 'snapshot_date_key'] },
      houses: { rows: result.tables.houses, columns: ['id', 'name', 'dynasty_id'] },
      dynasties: { rows: result.tables.dynasties, columns: ['id', 'name'] },
      titles: { rows: result.tables.titles.filter(t => t.holder_id != null && ids.has(String(t.holder_id))), columns: ['id', 'holder_id'] },
      traits: { rows: result.tables.traits, columns: ['id'] },
      character_traits: { rows: result.tables.character_traits.filter(t => ids.has(String(t.character_id))), columns: ['character_id', 'trait_id'] },
      relationships: { rows: result.tables.relationships.filter(r => ids.has(String(r.character_id))), columns: ['character_id', 'relative_id', 'relation'] },
    };
    const require = createRequire(import.meta.url);
    const db = await duck.createDuckDB({ mvp: { mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'), mainWorker: '' } }, new duck.VoidLogger(), duck.NODE_RUNTIME);
    await db.instantiate();
    const connection = db.connect();
    try {
      for (const [name, { rows, columns, numeric = [] }] of Object.entries(inputs)) {
        connection.query(`CREATE TABLE "${name}" (${columns.map(column => `"${column}" ${numeric.includes(column) ? 'DOUBLE' : 'VARCHAR'}`).join(', ')})`);
        for (let offset = 0; offset < rows.length; offset += 200) {
          const values = rows.slice(offset, offset + 200).map(row => `(${columns.map(column => {
            const value = row[column];
            return value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
          }).join(', ')})`).join(', ');
          connection.query(`INSERT INTO "${name}" VALUES ${values}`);
        }
      }
      const selected = sample.filter(c => c.dynasty_id === dynastyId);
      const population = connection.query(analyticalQuerySql({ filters, scope: 'selected', grain: 'character', metricIds: ['population'] })).get(0);
      expect(Number(population?.population)).toBe(selected.length);
      const world = connection.query(analyticalQuerySql({ filters, scope: 'world', grain: 'character', metricIds: ['population'] })).get(0);
      expect(Number(world?.population)).toBe(sample.length);
      const held = connection.query(analyticalQuerySql({ filters, scope: 'selected', grain: 'title', metricIds: ['titles'] })).get(0);
      const selectedIds = new Set(selected.map(c => String(c.id)));
      const expectedTitles = result.tables.titles.filter(t => t.holder_id != null && selectedIds.has(String(t.holder_id))).length;
      expect(Number(held?.titles)).toBe(expectedTitles);
    } finally {
      connection.close();
      db.reset();
    }
    console.log(`Validated ${result.tables.characters.length} unique characters, ${result.tables.houses.length} houses, ${result.tables.dynasties.length} dynasties.`);
  }, 120000);
});

const localizationPath = process.env.CK3_LOCALIZATION_DIR;
const gamePath = process.env.CK3_GAME_DIR;
describe.skipIf(!gamePath || !path)('local game definitions with real save', () => {
  it('resolves founding and cadet houses, religion and culture pillars', async () => {
    const parser = await Jomini.initialize();
    const definitions = emptyDefinitions();
    for (const folder of ['dynasties', 'dynasty_houses']) {
      const directory = join(gamePath!, 'common', folder);
      for (const file of (await readdir(directory)).filter(name => name.endsWith('.txt')).sort()) {
        addDefinitions(definitions, `common/${folder}/${file}`, parser.parseText(await readFile(join(directory, file)), { typeNarrowing: 'none' }));
      }
    }
    const root = join(gamePath!, 'localization', 'english');
    async function localizationFiles(folder: string, relative: string): Promise<{ path: string; content: string }[]> {
      const entries = await readdir(folder, { withFileTypes: true });
      const files = await Promise.all(entries.map(async entry => {
        const path = join(folder, entry.name), key = `${relative}/${entry.name}`;
        if (entry.isDirectory()) return localizationFiles(path, key);
        if (!/\.ya?ml$/i.test(entry.name)) return [];
        return [{ path: key, content: new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)) }];
      }));
      return files.flat();
    }
    const loc = createLocalization(await localizationFiles(root, 'english'));
    const result = parser.parseText(extractGamestate(await readFile(path!)), { typeNarrowing: 'none' }, query => {
      const source: Record<string, unknown> = {};
      for (const key of ['date', 'living', 'dead_unprunable', 'dynasties', 'culture_manager', 'faiths', 'rites', 'religion']) source[key] = query.at(`/${key}`);
      return normalize(source, loc, definitions);
    });
    const branch = result.tables.houses.find(h => h.key === 'house_jerome_karling');
    expect(branch?.name).toBe('Jerome-Karling');
    expect(result.tables.dynasties.find(d => d.id === branch?.dynasty_id)?.name).toBe('Karling');
    expect(result.tables.religions.find(r => r.tag === 'christianity_religion')?.name).toBe('Christianity');
    expect(result.tables.religions.find(r => r.tag === 'zoroastrianism_religion')?.name).toBe('Zoroastrianism');
    const numbered = result.tables.houses.find(h => h.key === '12319');
    expect(numbered?.name).toBe(loc.lookup('dynn_Kalyani_Chalukya'));
    expect(numbered?.name).not.toBe('12319');
    expect(result.tables.faiths.find(f => f.tag === 'catholic')?.color).toBe('#cccc99');
    expect(result.tables.rites.find(r => r.key === 'roman_rite')?.color).toBe('#cccc99');
    expect(result.tables.cultures.find(c => c.key === 'frankish')).toMatchObject({ heritage_key: 'heritage_frankish', heritage: 'Frankish', language_key: 'language_frankish', language: 'Frankish' });
  }, 120000);
});
describe.skipIf(!localizationPath)('local game localization integration', () => {
  it('resolves representative entity names without bundling game files', async () => {
    const paths = [['dynasties', 'dynasty_names_l_english.yml'], ['culture', 'cultures_l_english.yml'], ['religion', 'religion_paganism_l_english.yml'], ['religion', 'rites_l_english.yml'], ['traits_l_english.yml'], ['titles_l_english.yml']];
    const files = await Promise.all(paths.map(async parts => ({ path: parts.join('\\'), content: await readFile(join(localizationPath!, ...parts), 'utf8') })));
    const loc = createLocalization(files);
    expect(loc.lookup('dynn_Mana')).toBe('Mana');
    expect(loc.lookup('dynnp_de')).toBe('de ');
    expect(loc.lookup('castilian')).toBe('Castilian');
    expect(loc.lookup('akom_religion')).toBe('Akan');
    expect(loc.lookup('roman_rite')).toBe('Roman Rite');
    expect(loc.lookup('trait_brave')).toBe('Brave');
    expect(loc.lookup('k_france')).toBe('France');
  });
});
