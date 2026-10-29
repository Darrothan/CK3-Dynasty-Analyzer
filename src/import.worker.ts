import { Jomini } from 'jomini';
import { extractGamestate } from './import';
import { normalize, type Snapshot } from './model';
import { createDatabase, exportTable, queryAnalytics, queryCohorts, queryTable } from './database';
import { createLocalization, type LocalizationFile } from './localization';
import { metrics, type AnalyticalQuery, type CohortFilters } from './analytics';

let bytes: Uint8Array | null = null;
let snapshot: Snapshot | null = null;
let database: Awaited<ReturnType<typeof createDatabase>> | null = null;
const post = (stage: string) => self.postMessage({ type: 'stage', stage });
self.onmessage = async (event: MessageEvent<{
  type: string; file?: File; path?: string; dataset?: string; search?: string;
  page?: number; dimension?: string; dynasty?: string; includeDead?: boolean; id?: string;
  requestId?: number; aggregation?: string; measure?: string; group?: string; limit?: number; sort?: string;
  filters?: { column: string; value: string }[]; sortColumn?: string; sortDirection?: string;
  kind?: string;
  categoryFilter?: { column: string; value: string; isMissing: boolean } | null;
  selectedColumns?: string[];
  localizationFiles?: File[];
  cohort?: CohortFilters;
  analytics?: AnalyticalQuery;
}>) => {
  try {
    const parser = await Jomini.initialize();
    if (event.data.type === 'import' && event.data.file) {
      post('Reading file');
      if (event.data.file.size > 512 * 1024 * 1024) throw new Error('The file exceeds the 512 MiB import limit.');
      const input = new Uint8Array(await event.data.file.arrayBuffer());
      const files = event.data.localizationFiles ?? [];
      if (files.reduce((sum, file) => sum + file.size, 0) > 128 * 1024 * 1024) throw new Error('Localization files exceed the 128 MiB import limit.');
      const localizationFiles: LocalizationFile[] = [];
      if (files.length) post('Reading optional local localization files');
      for (const file of files) {
        if (!/\.ya?ml$/i.test(file.name)) continue;
        const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        localizationFiles.push({ path: file.webkitRelativePath || file.name, content });
      }
      const localization = createLocalization(localizationFiles);
      post('Extracting gamestate');
      bytes = extractGamestate(input);
      post('Parsing game data');
      snapshot = parser.parseText(bytes, { typeNarrowing: 'none' }, query => {
        post('Resolving references and building analytical tables');
        const data: Record<string, unknown> = {};
        for (const name of ['date', 'meta_data', 'living', 'dead_unprunable', 'dynasties', 'culture_manager', 'traits_lookup', 'faiths', 'rites', 'religion']) data[name] = query.at(`/${name}`);
        data.landed_titles = { landed_titles: query.at('/landed_titles/landed_titles') };
        return normalize(data, localization);
      });
      if (files.length && !localization.entries) snapshot.warnings.push('No CK3 localization entries were found in the selected files.');
      if (localization.collisions) snapshot.warnings.push(`Localization: ${localization.collisions} conflicting definitions; later sorted file/line wins.`);
      if (!snapshot.tables.characters.length) throw new Error('No supported character records found. This may not be a compatible CK3 gamestate.');
      post('Building local DuckDB tables');
      database = await createDatabase(snapshot.tables, name => post(`Building analytical table: ${name}`));
      const tables = Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) =>
        [name, { count: rows.length, columns: rows.length ? Object.keys(rows[0]) : [] }]));
      const dynastyCounts = new Map<string, number>();
      const dynastyLiving = new Map<string, number>();
      for (const dynasty of snapshot.tables.dynasties) dynastyCounts.set(String(dynasty.id), 0);
      for (const row of snapshot.tables.characters) if (row.dynasty_id !== null) {
        const id = String(row.dynasty_id);
        dynastyCounts.set(id, (dynastyCounts.get(id) ?? 0) + 1);
        if (row.status === 'Living') dynastyLiving.set(id, (dynastyLiving.get(id) ?? 0) + 1);
      }
      const houseNames = new Map<string, string[]>();
      for (const house of snapshot.tables.houses) if (house.dynasty_id != null && house.name != null) {
        const id = String(house.dynasty_id), names = houseNames.get(id) ?? [];
        names.push(String(house.name)); houseNames.set(id, names);
      }
      const dynastyNames = new Map(snapshot.tables.dynasties.map(d => [String(d.id), d.name == null ? '' : String(d.name)]));
      const dynasties = [...dynastyCounts].map(([id, count]) => ({ id, name: dynastyNames.get(id) ?? '', count, living: dynastyLiving.get(id) ?? 0, house: houseNames.get(id)?.[0] ?? '', houseSearch: houseNames.get(id)?.join(' ') ?? '' })).sort((a, b) => b.count - a.count);
      const living = snapshot.tables.characters.filter(row => row.status === 'Living').length;
      const houses = snapshot.tables.houses.map(h => ({ id: String(h.id), dynastyId: h.dynasty_id == null ? '' : String(h.dynasty_id), name: String(h.name ?? `House ${h.id}`) }));
      self.postMessage({ type: 'ready', date: snapshot.date, warnings: snapshot.warnings, tables, dynasties, houses, living });
    } else if (event.data.type === 'cohorts' && database && event.data.cohort) {
      const cohorts = await queryCohorts(database.connection, event.data.cohort);
      self.postMessage({ type: 'cohorts', requestId: event.data.requestId, cohorts });
    } else if (event.data.type === 'analytics' && database && event.data.analytics) {
      const request = event.data.analytics;
      const rows = await queryAnalytics(database.connection, request);
      self.postMessage({ type: 'analytics', requestId: event.data.requestId, rows, definitions: request.metricIds.map(id => ({ id, ...metrics[id] })) });
    } else if (event.data.type === 'query' && snapshot && database) {
      const dataset = event.data.dataset || 'characters';
      const all = snapshot.tables[dataset];
      if (!all) throw new Error('Unknown dataset.');
      const page = Math.max(0, event.data.page || 0);
      if (!all.length) { self.postMessage({ type: 'result', requestId: event.data.requestId, rows: [], total: 0, page, chart: [] }); return; }
      const result = await queryTable(database.connection, dataset, Object.keys(all[0]), event.data.dimension || '', event.data.search || '', event.data.dynasty || '', event.data.includeDead !== false, page, event.data.aggregation || 'count', event.data.measure || '', event.data.group || '', event.data.limit || 20, event.data.sort || 'value', event.data.filters || [], event.data.sortColumn || '', event.data.sortDirection || 'asc', event.data.kind || 'bar', event.data.categoryFilter || null, snapshot.tables.character_traits.length > 0);
      self.postMessage({ type: 'result', requestId: event.data.requestId, ...result });
    } else if (event.data.type === 'export' && snapshot && database) {
      const dataset = event.data.dataset || 'characters';
      const rows = snapshot.tables[dataset];
      if (!rows || !rows.length) throw new Error('There are no rows to export from this dataset.');
      const blob = await exportTable(database.connection, dataset, Object.keys(rows[0]), event.data.selectedColumns || [], event.data.search || '', event.data.dynasty || '', event.data.includeDead !== false, event.data.filters || [], event.data.categoryFilter || null, event.data.sortColumn || '', event.data.sortDirection || 'asc');
      self.postMessage({ type: 'export', dataset, blob });
    } else if (event.data.type === 'character' && snapshot) {
      const id = event.data.id;
      const character = snapshot.tables.characters.find(row => row.id === id);
      const traits = snapshot.tables.character_traits.filter(row => row.character_id === id);
      const relationships = snapshot.tables.relationships.filter(row => row.character_id === id);
      const titles = snapshot.tables.titles.filter(row => row.holder_id === id);
      self.postMessage({ type: 'character', character, traits, relationships, titles });
    } else if (event.data.type === 'raw' && bytes) {
      const path = event.data.path || '/';
      if (path === '/') throw new Error('Enter a specific path, such as /living/36959, to avoid materializing the entire save.');
      const value = parser.parseText(bytes, { typeNarrowing: 'none' }, query => query.at(path));
      let output = JSON.stringify(value, null, 2);
      if (output === undefined) output = 'No value found at this path.';
      if (output.length > 200000) output = output.slice(0, 200000) + '\n… truncated; query a more specific path.';
      self.postMessage({ type: 'raw', output });
    }
  } catch (error) {
    self.postMessage({ type: 'error', requestId: event.data.requestId, message: error instanceof Error ? error.message : String(error) });
  }
};
