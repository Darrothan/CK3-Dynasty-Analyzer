import { parseDate } from './dates';
import { skillNames } from './model';

export const characterViewSql = `CREATE VIEW character_analytics AS SELECT *, ${skillNames.map((name, index) => `skill_${index} AS "${name}"`).join(', ')} FROM characters`;
export const characterSkillsViewSql = `CREATE VIEW character_skills AS ${skillNames.map((name, index) =>
  `SELECT id AS character_id, ${index} AS skill_position, '${name}' AS skill_name, skill_${index} AS value FROM characters WHERE skill_${index} IS NOT NULL`).join(' UNION ALL ')}`;

export type CohortStatus = 'Both' | 'Living' | 'Deceased';
export type CohortSex = 'All' | 'Female' | 'Male' | 'Unknown';
export type RulerFilter = 'All' | 'Ruler' | 'Non-ruler' | 'Unknown';
export type HistoricalFilter =
  | { mode: 'alive_on'; date: string }
  | { mode: 'alive_during' | 'born_during' | 'died_during'; start: string; end: string };
export interface CohortFilters {
  dynastyId: string;
  houseId: string;
  status: CohortStatus;
  sex: CohortSex;
  ruler?: RulerFilter;
  historical?: HistoricalFilter | null;
}

export interface MetricDefinition {
  description: string;
  grain: 'character' | 'house' | 'dynasty' | 'title' | 'trait' | 'relationship';
  requiredFields: readonly string[];
  supportedFilters: readonly string[];
  denominator: string;
  aggregation: string;
  temporal: 'snapshot' | 'recorded-event';
  comparison: boolean;
  missing: string;
  measures: readonly { alias: string; operation: 'count' | 'count_distinct' | 'avg' | 'median'; field: string | null }[];
}

export const metrics = {
  population: {
    description: 'Parsed characters', grain: 'character', requiredFields: ['id'],
    supportedFilters: ['dynasty', 'house', 'status', 'sex', 'ruler', 'historical'],
    denominator: 'All characters satisfying the cohort filters', aggregation: 'distinct character count',
    temporal: 'snapshot', comparison: true, missing: 'Unknown eligibility is excluded',
    measures: [{ alias: 'population', operation: 'count_distinct', field: 'id' }],
  },
  age: {
    description: 'Completed age at save date or death', grain: 'character', requiredFields: ['age'],
    supportedFilters: ['dynasty', 'house', 'status', 'sex', 'ruler', 'historical'],
    denominator: 'Characters with a valid recorded age', aggregation: 'count, mean, median',
    temporal: 'snapshot', comparison: true, missing: 'Null ages are excluded',
    measures: [
      { alias: 'age_count', operation: 'count', field: 'age' },
      { alias: 'mean_age', operation: 'avg', field: 'age' },
      { alias: 'median_age', operation: 'median', field: 'age' },
    ],
  },
  historical_age: {
    description: 'Completed age on the selected historical date', grain: 'character', requiredFields: ['birth', 'birth_key', 'death_key', 'snapshot_date_key'],
    supportedFilters: ['dynasty', 'house', 'status', 'sex', 'ruler', 'historical'],
    denominator: 'Eligible characters known to be alive with a valid birth date at the selected date',
    aggregation: 'count, mean, median', temporal: 'recorded-event', comparison: true, missing: 'Unknown or not alive on date is excluded',
    measures: [
      { alias: 'historical_age_count', operation: 'count', field: 'historical_age' },
      { alias: 'mean_historical_age', operation: 'avg', field: 'historical_age' },
      { alias: 'median_historical_age', operation: 'median', field: 'historical_age' },
    ],
  },
  houses: { description: 'Parsed houses', grain: 'house', requiredFields: ['id'], supportedFilters: [], denominator: 'Parsed house records', aggregation: 'distinct house count', temporal: 'snapshot', comparison: false, missing: 'Missing IDs excluded', measures: [{ alias: 'houses', operation: 'count_distinct', field: 'id' }] },
  dynasties: { description: 'Parsed dynasties', grain: 'dynasty', requiredFields: ['id'], supportedFilters: [], denominator: 'Parsed dynasty records', aggregation: 'distinct dynasty count', temporal: 'snapshot', comparison: false, missing: 'Missing IDs excluded', measures: [{ alias: 'dynasties', operation: 'count_distinct', field: 'id' }] },
  titles: { description: 'Parsed titles', grain: 'title', requiredFields: ['id'], supportedFilters: [], denominator: 'Parsed title records', aggregation: 'distinct title count', temporal: 'snapshot', comparison: false, missing: 'Missing IDs excluded', measures: [{ alias: 'titles', operation: 'count_distinct', field: 'id' }] },
  traits: { description: 'Parsed traits', grain: 'trait', requiredFields: ['id'], supportedFilters: [], denominator: 'Parsed trait lookup entries', aggregation: 'distinct trait count', temporal: 'snapshot', comparison: false, missing: 'Missing IDs excluded', measures: [{ alias: 'traits', operation: 'count_distinct', field: 'id' }] },
  relationships: { description: 'Recorded relationship rows', grain: 'relationship', requiredFields: ['character_id', 'relative_id'], supportedFilters: [], denominator: 'Relationship rows, including derived links', aggregation: 'row count', temporal: 'snapshot', comparison: false, missing: 'Rows retained as recorded', measures: [{ alias: 'relationships', operation: 'count', field: null }] },
} as const satisfies Record<string, MetricDefinition>;

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const keyOf = (value: string) => {
  const parsed = parseDate(value);
  if (parsed.key === null) throw new Error(`Invalid or placeholder historical date: ${value}`);
  return parsed.key;
};

// SQL's NULL represents unknown eligibility; callers include only TRUE.
export function historicalPredicate(filter: HistoricalFilter): string {
  const start = keyOf(filter.mode === 'alive_on' ? filter.date : filter.start);
  const end = filter.mode === 'alive_on' ? start : keyOf(filter.end);
  if (start > end) throw new Error('Historical date range starts after it ends.');
  const guard = `snapshot_date_key IS NULL OR snapshot_date_key < ${end} OR date_consistency <> 'consistent'`;
  if (filter.mode === 'born_during') return `(CASE WHEN ${guard} OR birth_key IS NULL THEN NULL ELSE birth_key BETWEEN ${start} AND ${end} END)`;
  if (filter.mode === 'died_during') return `(CASE WHEN ${guard} THEN NULL WHEN status = 'Living' THEN FALSE WHEN death_key IS NULL THEN NULL ELSE death_key BETWEEN ${start} AND ${end} END)`;
  return `(CASE WHEN ${guard} THEN NULL WHEN birth_key > ${end} OR death_key < ${start} THEN FALSE WHEN birth_key IS NULL OR (status = 'Deceased' AND death_key IS NULL) THEN NULL ELSE TRUE END)`;
}

export function characterFilterClauses(filters: CohortFilters, scope: 'selected' | 'world' | 'rest'): string[] {
  if (!['Both', 'Living', 'Deceased'].includes(filters.status) || !['All', 'Female', 'Male', 'Unknown'].includes(filters.sex) || !['All', 'Ruler', 'Non-ruler', 'Unknown'].includes(filters.ruler ?? 'All')) throw new Error('Invalid cohort filter.');
  const where: string[] = [];
  if (filters.status !== 'Both') where.push(`status = ${literal(filters.status)}`);
  if (filters.sex !== 'All') where.push(`sex = ${literal(filters.sex)}`);
  if (filters.ruler && filters.ruler !== 'All') where.push(`ruler_status = ${literal(filters.ruler)}`);
  if (filters.historical) where.push(`${historicalPredicate(filters.historical)} IS TRUE`);
  if (scope === 'selected') {
    if (filters.dynastyId) where.push(`dynasty_id = ${literal(filters.dynastyId)}`);
    if (filters.houseId) where.push(`house_id = ${literal(filters.houseId)}`);
  } else if (scope === 'rest') {
    if (!filters.dynastyId) throw new Error('Select a dynasty before excluding it.');
    where.push(`(dynasty_id IS NULL OR dynasty_id <> ${literal(filters.dynastyId)})`);
  }
  return where;
}

export function metricProjection(ids: readonly (keyof typeof metrics)[], grain: MetricDefinition['grain'] = 'character'): string {
  if (!ids.length || ids.some(id => !Object.hasOwn(metrics, id))) throw new Error('Unknown or empty metric selection.');
  if (ids.some(id => metrics[id].grain !== grain)) throw new Error('Metrics must share the requested entity grain.');
  return ids.flatMap(id => metrics[id].measures.map(measure => {
    const field = measure.field === null ? '*' : `"${measure.field.replaceAll('"', '""')}"`;
    const expression = measure.operation === 'count_distinct' ? `count(DISTINCT ${field})` : `${measure.operation}(${field})`;
    return `${expression} AS "${measure.alias.replaceAll('"', '""')}"`;
  })).join(', ');
}

export interface AnalyticalQuery {
  grain: MetricDefinition['grain'];
  metricIds: readonly (keyof typeof metrics)[];
  filters: CohortFilters;
  scope: 'selected' | 'world' | 'rest';
  groupBy?: 'house' | 'dynasty';
  traitId?: string;
  relation?: string;
  historicalAgeDate?: string;
  limit?: number;
}

export function historicalAgeExpression(date: string): string {
  const parsed = parseDate(date);
  if (parsed.key === null || parsed.year === null || parsed.month === null || parsed.day === null) throw new Error(`Invalid or placeholder historical date: ${date}`);
  const alive = historicalPredicate({ mode: 'alive_on', date });
  return `(CASE WHEN ${alive} IS TRUE THEN ${parsed.year} - CAST(split_part(birth, '.', 1) AS INTEGER) - CASE WHEN ${parsed.month} < CAST(split_part(birth, '.', 2) AS INTEGER) OR (${parsed.month} = CAST(split_part(birth, '.', 2) AS INTEGER) AND ${parsed.day} < CAST(split_part(birth, '.', 3) AS INTEGER)) THEN 1 ELSE 0 END ELSE NULL END)`;
}

export function analyticalQuerySql(query: AnalyticalQuery): string {
  const projection = metricProjection(query.metricIds, query.grain);
  if (!['selected', 'world', 'rest'].includes(query.scope)) throw new Error('Unsupported cohort scope.');
  if (query.groupBy && !['house', 'dynasty'].includes(query.groupBy)) throw new Error('Unsupported grouping.');
  const limit = query.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Result limit must be between 1 and 1000.');
  if (query.metricIds.includes('historical_age') && !query.historicalAgeDate) throw new Error('Historical age requires a date.');
  const ageExpression = query.historicalAgeDate ? historicalAgeExpression(query.historicalAgeDate) : 'NULL';
  const where = characterFilterClauses(query.filters, query.scope);
  if (query.traitId) where.push(`EXISTS (SELECT 1 FROM character_traits ct WHERE ct.character_id = character_analytics.id AND ct.trait_id = ${literal(query.traitId)})`);
  if (query.relation) where.push(`EXISTS (SELECT 1 FROM relationships r WHERE r.character_id = character_analytics.id AND r.relation = ${literal(query.relation)})`);
  const joins: Record<MetricDefinition['grain'], string> = {
    character: 'SELECT e.id, e.age, e.historical_age, e.house_id, e.dynasty_id, e.house_name, e.dynasty_name FROM eligible e',
    house: 'SELECT h.id, e.house_id, e.dynasty_id, e.house_name, e.dynasty_name FROM eligible e JOIN houses h ON h.id = e.house_id',
    dynasty: 'SELECT d.id, e.house_id, e.dynasty_id, e.house_name, e.dynasty_name FROM eligible e JOIN dynasties d ON d.id = e.dynasty_id',
    title: 'SELECT t.id, e.house_id, e.dynasty_id, e.house_name, e.dynasty_name FROM eligible e JOIN titles t ON t.holder_id = e.id',
    trait: 'SELECT t.id, e.house_id, e.dynasty_id, e.house_name, e.dynasty_name FROM eligible e JOIN character_traits ct ON ct.character_id = e.id JOIN traits t ON t.id = ct.trait_id',
    relationship: 'SELECT r.character_id AS id, e.house_id, e.dynasty_id, e.house_name, e.dynasty_name FROM eligible e JOIN relationships r ON r.character_id = e.id',
  };
  if (!Object.hasOwn(joins, query.grain)) throw new Error('Unsupported entity grain.');
  const groupColumn = query.groupBy ? `${query.groupBy}_id` : '';
  const groupSelect = groupColumn ? `"${groupColumn}" AS group_id, max("${query.groupBy}_name") AS group_name` : 'NULL AS group_id, NULL AS group_name';
  const groupBy = groupColumn ? ` GROUP BY "${groupColumn}"` : '';
  return `WITH eligible_base AS (SELECT *, ${ageExpression} AS historical_age FROM character_analytics${where.length ? ` WHERE ${where.join(' AND ')}` : ''}), eligible AS (SELECT c.*, h.name AS house_name, d.name AS dynasty_name FROM eligible_base c LEFT JOIN houses h ON h.id = c.house_id LEFT JOIN dynasties d ON d.id = h.dynasty_id), linked AS (${joins[query.grain]}) SELECT ${groupSelect}, ${projection} FROM linked${groupBy} ORDER BY group_id NULLS LAST LIMIT ${limit}`;
}

export function cohortSql(filters: CohortFilters): string {
  if (!filters.dynastyId) throw new Error('Select a dynasty before calculating a comparison.');
  const query = (scope: 'selected' | 'world' | 'rest') => {
    const where = characterFilterClauses(filters, scope);
    const base = characterFilterClauses({ ...filters, historical: null }, scope);
    const unknown = filters.historical
      ? `(SELECT count(*) FROM character_analytics WHERE ${[...base, `${historicalPredicate(filters.historical)} IS NULL`].join(' AND ')})`
      : '0';
    return `SELECT '${scope}' AS cohort, ${metricProjection(['population', 'age'])}, ${unknown} AS historical_unknown FROM character_analytics${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  };
  return [query('selected'), query('world'), query('rest')].join(' UNION ALL ');
}
