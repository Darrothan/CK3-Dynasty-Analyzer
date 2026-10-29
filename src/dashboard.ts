import { characterFilterClauses, cohortSql, type CohortFilters } from './analytics';
import { skillNames } from './model';

export type DashboardSection = 'overview' | 'demographics' | 'culture' | 'traits' | 'skills' | 'houses';
export type DrillKind = 'house' | 'sex' | 'age' | 'culture' | 'heritage' | 'language' | 'faith' | 'rite' | 'religion' | 'trait' | 'birth' | 'death' | 'skill';
export type DashboardDrill = { kind: DrillKind; value: string | null; label: string; skill?: string; houseId?: string | null; status?: 'Living' | 'Deceased'; ruler?: 'Ruler' };
export interface DashboardRequest {
  filters: CohortFilters;
  section: DashboardSection;
  drill: DashboardDrill | null;
  page?: number;
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const where = (filters: CohortFilters, scope: 'selected' | 'world' = 'selected') => {
  const clauses = characterFilterClauses(filters, scope);
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
};
const eligible = (filters: CohortFilters, scope: 'selected' | 'world' = 'selected') =>
  `SELECT * FROM character_analytics${where(filters, scope)}`;
const category = (id: string, label: string) =>
  `SELECT ${id} AS id, CASE WHEN ${id} IS NULL THEN 'Unknown' ELSE coalesce(max(${label}), concat('Unresolved #', ${id})) END AS label, count(*) AS n FROM cohort GROUP BY ${id} ORDER BY n DESC, label LIMIT 100`;

export function dashboardQueries(request: DashboardRequest): Record<string, string> {
  const { filters, section, drill } = request;
  if (!filters.dynastyId) throw new Error('Select a dynasty.');
  const base = `WITH cohort AS (${eligible(filters)}) `;
  const queries: Record<string, string> = { cohorts: cohortSql(filters) };
  if (section === 'overview' || section === 'houses') {
    queries.summary = base + `SELECT count(*) AS population, count(*) FILTER (WHERE status = 'Living') AS living, count(*) FILTER (WHERE status = 'Deceased') AS deceased, count(DISTINCT house_id) AS houses, count(*) FILTER (WHERE ruler_status = 'Ruler') AS rulers, count(*) FILTER (WHERE ruler_status = 'Unknown') AS ruler_unknown FROM cohort`;
    queries.houses = base + `SELECT house_id AS id, coalesce(max(house), 'Unknown house') AS label, count(*) AS n, count(*) FILTER (WHERE status = 'Living') AS living, count(*) FILTER (WHERE status = 'Deceased') AS deceased, count(*) FILTER (WHERE ruler_status = 'Ruler') AS rulers FROM cohort GROUP BY house_id ORDER BY n DESC, label LIMIT 100`;
    if (section === 'houses') queries.titles = base + `SELECT t.id, coalesce(t.name, t.key, concat('Title #', t.id)) AS title, c.name AS holder, c.house FROM cohort c JOIN titles t ON t.holder_id = c.id ORDER BY title, t.id LIMIT 100`;
  }
  if (section === 'demographics') {
    queries.sex = base + category('sex', 'sex');
    queries.age = base + `SELECT age_group AS id, age_group AS label, count(*) AS n FROM cohort GROUP BY age_group ORDER BY min(age) ASC NULLS LAST`;
    for (const event of ['birth', 'death'] as const) {
      queries[event] = base + `SELECT cast(floor(${event}_key / 10000.0 / 10) * 10 AS VARCHAR) AS id, concat(cast(floor(${event}_key / 10000.0 / 10) * 10 AS INTEGER), 's') AS label, count(*) AS n FROM cohort WHERE ${event}_key IS NOT NULL GROUP BY floor(${event}_key / 10000.0 / 10) ORDER BY floor(${event}_key / 10000.0 / 10)`;
    }
    queries.lifespan = base + `SELECT count(age) AS known, avg(age) AS mean, median(age) AS median FROM cohort WHERE status = 'Deceased'`;
    queries.date_quality = base + `SELECT count(*) FILTER (WHERE birth_key IS NULL) AS missing_birth, count(*) FILTER (WHERE status = 'Deceased' AND death_key IS NULL) AS missing_death FROM cohort`;
    queries.history = base + `, dates AS (
      SELECT (floor(max(snapshot_date_key) / 10000.0 / 10) * 10 - n * 10) * 10000 + 101 AS date_key
      FROM cohort CROSS JOIN generate_series(0, 49) s(n)
      GROUP BY n HAVING max(snapshot_date_key) IS NOT NULL AND min(birth_key) <= (floor(max(snapshot_date_key) / 10000.0 / 10) * 10 - n * 10) * 10000 + 101
    ), evaluated AS (
      SELECT dates.date_key, CASE WHEN c.snapshot_date_key IS NULL OR c.snapshot_date_key < dates.date_key OR c.date_consistency <> 'consistent' THEN NULL
        WHEN c.birth_key > dates.date_key OR c.death_key < dates.date_key THEN FALSE
        WHEN c.birth_key IS NULL OR (c.status = 'Deceased' AND c.death_key IS NULL) THEN NULL ELSE TRUE END AS alive
      FROM dates CROSS JOIN cohort c
    ) SELECT cast(date_key / 10000 AS INTEGER) AS year, count(*) FILTER (WHERE alive IS TRUE) AS n, count(*) FILTER (WHERE alive IS NULL) AS unknown FROM evaluated GROUP BY date_key ORDER BY date_key`;
  }
  if (section === 'culture') {
    queries.culture = base + category('culture_id', 'culture');
    queries.faith = base + category('faith_id', 'faith');
    queries.religion = base + `SELECT c.religion_id AS id, coalesce(max(r.name), CASE WHEN c.religion_id IS NULL THEN 'Unknown' ELSE concat('Unresolved #', c.religion_id) END) AS label, count(*) AS n FROM cohort c LEFT JOIN religions r ON r.id = c.religion_id GROUP BY c.religion_id ORDER BY n DESC LIMIT 100`;
    queries.rite = base + category('rite_id', 'rite');
    const hierarchyFrom = `FROM cohort c LEFT JOIN religions r ON r.id = c.religion_id LEFT JOIN faiths f ON f.id = c.faith_id LEFT JOIN rites rt ON rt.id = c.rite_id`;
    const religionLabel = `coalesce(max(r.name), CASE WHEN c.religion_id IS NULL THEN 'Unknown religion' ELSE concat('Unresolved religion #', c.religion_id) END)`;
    const faithLabel = `CASE WHEN c.faith_id IS NULL THEN 'Unknown faith' ELSE coalesce(max(c.faith), concat('Unresolved faith #', c.faith_id)) END`;
    queries.hierarchy = base + `SELECT 1 AS level, c.religion_id, NULL AS faith_id, NULL AS rite_id, ${religionLabel} AS religion, NULL AS faith, NULL AS rite, max(r.tag) AS religion_key, NULL AS faith_key, NULL AS rite_key, NULL AS color, count(*) AS n ${hierarchyFrom} GROUP BY c.religion_id
      UNION ALL SELECT 2, c.religion_id, c.faith_id, NULL, ${religionLabel}, ${faithLabel}, NULL, max(r.tag), max(f.tag), NULL, max(f.color), count(*) ${hierarchyFrom} GROUP BY c.religion_id, c.faith_id
      UNION ALL SELECT 3, c.religion_id, c.faith_id, c.rite_id, ${religionLabel}, ${faithLabel}, coalesce(max(c.rite), 'Unknown rite'), max(r.tag), max(f.tag), max(rt.key), max(rt.color), count(*) ${hierarchyFrom} GROUP BY c.religion_id, c.faith_id, c.rite_id`;
    for (const pillar of ['heritage', 'language'] as const) {
      queries[`${pillar}_hierarchy`] = base + `SELECT 1 AS level, ${pillar}_key AS parent_id, NULL AS culture_id, coalesce(max(${pillar}), 'Unknown ${pillar}') AS parent, NULL AS culture, count(*) AS n FROM cohort GROUP BY ${pillar}_key
        UNION ALL SELECT 2, ${pillar}_key, culture_id, coalesce(max(${pillar}), 'Unknown ${pillar}'), coalesce(max(culture), 'Unknown culture'), count(*) FROM cohort GROUP BY ${pillar}_key, culture_id`;
    }
    queries.culture_house = base + `SELECT house_id, culture_id AS id, coalesce(house, 'Unknown house') AS house, coalesce(culture, 'Unknown') AS label, count(*) AS n FROM cohort GROUP BY house_id, house, culture_id, culture ORDER BY n DESC LIMIT 100`;
    queries.faith_house = base + `SELECT house_id, faith_id AS id, coalesce(max(house), 'Unknown house') AS house, CASE WHEN faith_id IS NULL THEN 'Unknown' ELSE coalesce(max(faith), concat('Unresolved #', faith_id)) END AS label, count(*) AS n FROM cohort GROUP BY house_id, faith_id ORDER BY n DESC LIMIT 100`;
  }
  if (section === 'traits') queries.trait = base + `SELECT t.trait_id AS id, coalesce(max(t.trait), 'Unknown') AS label, count(DISTINCT c.id) AS n FROM cohort c JOIN character_traits t ON t.character_id = c.id GROUP BY t.trait_id ORDER BY n DESC, label LIMIT 30`;
  if (section === 'skills') {
    const skillRows = (scope: 'selected' | 'world') => skillNames.map((name, i) => `SELECT '${scope}' AS cohort, '${name}' AS skill, skill_${i} AS value FROM (${eligible(filters, scope)}) WHERE skill_${i} IS NOT NULL`).join(' UNION ALL ');
    queries.skills = `WITH values_by_skill AS (${skillRows('selected')} UNION ALL ${skillRows('world')}) SELECT cohort, skill, count(*) AS n, avg(value) AS mean, median(value) AS median FROM values_by_skill GROUP BY cohort, skill ORDER BY skill, cohort`;
    queries.leaders = base + `SELECT id, name, house, diplomacy, martial, stewardship, intrigue, learning, prowess FROM cohort WHERE ${skillNames.map(name => `${name} IS NOT NULL`).join(' AND ')} ORDER BY diplomacy + martial + stewardship + intrigue + learning + prowess DESC, id LIMIT 25`;
    queries.skill_houses = base + skillNames.map((name, i) => `SELECT house_id AS id, coalesce(max(house), 'Unknown house') AS house, '${name}' AS skill, count(skill_${i}) AS n, avg(skill_${i}) AS mean, median(skill_${i}) AS median FROM cohort GROUP BY house_id`).join(' UNION ALL ');
    queries.skill_distribution = base + skillNames.map((name, i) => `SELECT '${name}' AS skill, skill_${i} AS value, count(*) AS n FROM cohort WHERE skill_${i} IS NOT NULL GROUP BY skill_${i}`).join(' UNION ALL ') + ' ORDER BY skill, value';
  }
  if (drill) {
    const page = request.page ?? 0;
    if (!Number.isInteger(page) || page < 0 || page > 100000) throw new Error('Invalid drilldown page.');
    const columns: Record<Exclude<DrillKind, 'trait' | 'birth' | 'death' | 'skill'>, string> = { house: 'house_id', sex: 'sex', age: 'age_group', culture: 'culture_id', heritage: 'heritage_key', language: 'language_key', faith: 'faith_id', rite: 'rite_id', religion: 'religion_id' };
    let predicate: string;
    if (drill.kind === 'trait') {
      if (drill.value === null) throw new Error('A trait ID is required.');
      predicate = `EXISTS (SELECT 1 FROM character_traits t WHERE t.character_id = cohort.id AND t.trait_id = ${literal(drill.value)})`;
    } else if (drill.kind === 'birth' || drill.kind === 'death') {
      const decade = Number(drill.value);
      if (drill.value === null || !Number.isInteger(decade) || decade % 10 !== 0 || Math.abs(decade) > 10000) throw new Error('Invalid decade.');
      predicate = `floor(${drill.kind}_key / 10000.0 / 10) * 10 = ${decade}`;
    } else if (drill.kind === 'skill') {
      if (!skillNames.some(name => name === drill.skill) || drill.value === null || !Number.isFinite(Number(drill.value))) throw new Error('Invalid skill drilldown.');
      predicate = `"${drill.skill}" = ${Number(drill.value)}`;
    } else {
      const column = columns[drill.kind];
      if (!column) throw new Error('Unsupported drilldown.');
      predicate = drill.value === null ? `${column} IS NULL` : `${column} = ${literal(drill.value)}`;
    }
    if (drill.houseId !== undefined) predicate += drill.houseId === null ? ' AND house_id IS NULL' : ` AND house_id = ${literal(drill.houseId)}`;
    if (drill.status !== undefined) {
      if (drill.status !== 'Living' && drill.status !== 'Deceased') throw new Error('Invalid drilldown status.');
      predicate += ` AND status = ${literal(drill.status)}`;
    }
    if (drill.ruler !== undefined) {
      if (drill.ruler !== 'Ruler') throw new Error('Invalid drilldown ruler status.');
      predicate += ` AND ruler_status = 'Ruler'`;
    }
    queries.drill = base + `SELECT id, name, house, status, age, culture, faith, ruler_status FROM cohort WHERE ${predicate} ORDER BY name NULLS LAST, id LIMIT 100 OFFSET ${page * 100}`;
    queries.drill_count = base + `SELECT count(*) AS n FROM cohort WHERE ${predicate}`;
  }
  return queries;
}
