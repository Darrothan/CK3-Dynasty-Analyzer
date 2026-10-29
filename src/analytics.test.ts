import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as duck from '@duckdb/duckdb-wasm/blocking';
import { analyticalQuerySql, characterSkillsViewSql, characterViewSql, cohortSql, historicalPredicate, metricProjection, type CohortFilters, type HistoricalFilter } from './analytics';
import { ageAtDeath, ageAtHistoricalDate, parseDate } from './dates';
import { normalize, numericColumns } from './model';
import { dashboardQueries, type DashboardSection } from './dashboard';

const source = {
  date: '900.1.1',
  living: {
    a: { first_name: 'Alice', birth: '850.1.1', dynasty_house: '2', female: 'yes', rite: '11', culture: '1', skill: ['1', '2', '3', '4', '5', '6'], traits: ['0', '0', '1'], family_data: { father: 'd', child: ['b', 'b'] } },
    b: { birth: '870.1.1', dynasty_house: '3', female: 'yes' },
    c: {},
    g: { birth: '900.2.1' },
  },
  dead_unprunable: {
    d: { birth: '800.1.1', dead_data: { date: '860.1.1' }, dynasty_house: '2', female: 'yes' },
    e: { birth: '830.1.1', dead_data: {} },
    f: { birth: '1.1.1', dead_data: { date: '880.1.1' } },
  },
  dynasties: { dynasty_house: { 2: { dynasty: '5', name: 'House Two' }, 3: { dynasty: '6', name: 'House Three' } }, dynasties: { 5: { name: 'Dynasty Five' }, 6: { name: 'Dynasty Six' } } },
  traits_lookup: ['brave', 'honest'],
  culture_manager: { cultures: { 1: { name: 'French', heritage: 'heritage_frankish', language: 'language_french' } } },
  rites: { database: { 11: { name: 'Rite Eleven', faith: '12', rite_type: 'rite_11', data: { color: { rgb: ['12', '34', '56'] } } } } },
  faiths: { database: { 12: { name: 'Faith Twelve', religion: '13', tag: 'faith_12', color: { rgb: ['204', '204', '153'] } } } },
  religion: { religions: { 13: { name: 'Religion Thirteen' } } },
  landed_titles: { landed_titles: { 1: { key: 'k_one', holder: 'a' }, 2: { key: 'd_two', holder: 'a' } } },
};

describe('DuckDB historical and semantic integration', () => {
  let db: Awaited<ReturnType<typeof duck.createDuckDB>>;
  let connection: ReturnType<typeof db.connect>;
  beforeAll(async () => {
    const require = createRequire(import.meta.url);
    db = await duck.createDuckDB({ mvp: { mainModule: require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'), mainWorker: '' } }, new duck.VoidLogger(), duck.NODE_RUNTIME);
    await db.instantiate();
    connection = db.connect();
    const { tables } = normalize(source);
    for (const name of ['characters', 'character_traits', 'houses', 'dynasties', 'titles', 'traits', 'relationships', 'religions', 'faiths', 'rites']) {
      const rows = tables[name];
      const columns = Object.keys(rows[0]);
      connection.query(`CREATE TABLE "${name}" (${columns.map(column => `"${column}" ${numericColumns.includes(column) ? 'DOUBLE' : 'VARCHAR'}`).join(', ')})`);
      for (const row of rows) connection.query(`INSERT INTO "${name}" VALUES (${columns.map(column => {
        const value = row[column];
        return value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
      }).join(', ')})`);
    }
    connection.query(characterViewSql);
    connection.query(characterSkillsViewSql);
  });
  afterAll(() => { connection?.close(); db?.reset(); });

  const rowsFor = (filter: HistoricalFilter) => connection.query(`SELECT id, ${historicalPredicate(filter)} AS eligible FROM character_analytics ORDER BY id`).toArray()
    .map(row => [String(row.id), row.eligible]);

  it('distinguishes true, false and unknown for alive-on dates', () => {
    expect(rowsFor({ mode: 'alive_on', date: '850.1.1' })).toEqual([
      ['a', true], ['b', false], ['c', null], ['d', true], ['e', null], ['f', null], ['g', null],
    ]);
    expect(rowsFor({ mode: 'alive_on', date: '860.1.1' }).find(r => r[0] === 'd')?.[1]).toBe(true);
    expect(rowsFor({ mode: 'alive_on', date: '860.1.2' }).find(r => r[0] === 'd')?.[1]).toBe(false);
  });
  it('includes any overlap in an inclusive interval and handles incomplete lifetimes', () => {
    const rows = rowsFor({ mode: 'alive_during', start: '860.1.1', end: '870.1.1' });
    expect(rows.find(r => r[0] === 'd')?.[1]).toBe(true);
    expect(rows.find(r => r[0] === 'b')?.[1]).toBe(true);
    expect(rows.find(r => r[0] === 'e')?.[1]).toBeNull();
  });
  it('filters births and deaths without treating missing dates as negatives', () => {
    const born = rowsFor({ mode: 'born_during', start: '850.1.1', end: '850.1.1' });
    expect(born.find(r => r[0] === 'a')?.[1]).toBe(true);
    expect(born.find(r => r[0] === 'c')?.[1]).toBeNull();
    const died = rowsFor({ mode: 'died_during', start: '860.1.1', end: '860.1.1' });
    expect(died.find(r => r[0] === 'd')?.[1]).toBe(true);
    expect(died.find(r => r[0] === 'a')?.[1]).toBe(false);
    expect(died.find(r => r[0] === 'e')?.[1]).toBeNull();
  });
  it('treats dates beyond the snapshot as unknown rather than projecting the population', () => {
    expect(rowsFor({ mode: 'alive_on', date: '901.1.1' }).every(r => r[1] === null)).toBe(true);
  });
  it('rejects invalid input and detects placeholders and impossible dates', () => {
    expect(parseDate('1.1.1').quality).toBe('placeholder');
    expect(parseDate('9999.1.1').quality).toBe('placeholder');
    expect(parseDate('867.2.30').quality).toBe('invalid');
    expect(parseDate('868.2.29').quality).toBe('valid');
    expect(parseDate('-17.1.1').quality).toBe('valid');
    expect(() => historicalPredicate({ mode: 'alive_during', start: '900.1.1', end: '800.1.1' })).toThrow(/starts after/);
    expect(() => historicalPredicate({ mode: 'alive_on', date: '1.1.1' })).toThrow(/placeholder/);
  });
  it('calculates historical age only when alive on the date and age at death only for valid lifetimes', () => {
    const dead = { birth: '800.7.26', death: '860.7.25', status: 'Deceased' as const, snapshotDate: '900.1.1' };
    expect(ageAtHistoricalDate(dead, '850.7.25')).toBe(49);
    expect(ageAtHistoricalDate(dead, '850.7.26')).toBe(50);
    expect(ageAtHistoricalDate(dead, '860.7.25')).toBe(59);
    expect(ageAtHistoricalDate(dead, '860.7.26')).toBeNull();
    expect(ageAtDeath(dead)).toBe(59);
    expect(ageAtDeath({ ...dead, death: null })).toBeNull();
    expect(ageAtDeath({ ...dead, death: '9999.1.1' })).toBeNull();
    expect(ageAtHistoricalDate({ ...dead, death: null }, '850.1.1')).toBeNull();
    const living = { birth: '850.1.1', death: null, status: 'Living' as const, snapshotDate: '900.1.1' };
    expect(ageAtHistoricalDate(living, '849.12.31')).toBeNull();
    expect(ageAtHistoricalDate(living, '900.1.2')).toBeNull();
    expect(ageAtDeath(living)).toBeNull();
  });
  it('applies matching benchmark filters without leaking house or dynasty', () => {
    const filters: CohortFilters = { dynastyId: '5', houseId: '2', status: 'Both', sex: 'Female', historical: { mode: 'alive_on', date: '850.1.1' } };
    const snapshot = connection.query(cohortSql({ ...filters, historical: null })).toArray();
    expect(snapshot.map(r => [r.cohort, Number(r.population)])).toEqual([
      ['selected', 2], ['world', 3], ['rest', 1],
    ]);
    const rows = connection.query(cohortSql(filters)).toArray();
    expect(rows.map(r => [r.cohort, Number(r.population), Number(r.historical_unknown)])).toEqual([
      ['selected', 2, 0], ['world', 2, 0], ['rest', 0, 0],
    ]);
    const unknown = connection.query(cohortSql({ ...filters, houseId: '', sex: 'All' })).toArray();
    expect(Number(unknown[1].historical_unknown)).toBe(4);
    expect(Number(unknown[1].population)).toBe(2);
  });
  it('preserves one character per population despite many trait links', () => {
    const count = connection.query('SELECT count(DISTINCT c.id) AS n, count(*) AS links FROM character_analytics c JOIN character_traits t ON t.character_id = c.id').get(0);
    expect(Number(count?.n)).toBe(1);
    expect(Number(count?.links)).toBe(3);
    const result = connection.query("SELECT skill_position, skill_name, value FROM character_skills WHERE character_id = 'a' ORDER BY skill_position").toArray();
    expect(result.map(r => [r.skill_name, r.value])).toEqual([['diplomacy', 1], ['martial', 2], ['stewardship', 3], ['intrigue', 4], ['learning', 5], ['prowess', 6]]);
  });
  it('keeps absent ruler evidence unknown instead of calling it a non-ruler', () => {
    expect(connection.query("SELECT count(*) AS n FROM character_analytics WHERE ruler_status = 'Non-ruler'").get(0)?.n).toBe(0n);
    expect(connection.query("SELECT count(*) AS n FROM character_analytics WHERE ruler_status = 'Unknown'").get(0)?.n).toBe(6n);
  });
  it('compiles metrics by explicit grain and refuses incompatible combinations', () => {
    expect(metricProjection(['houses'], 'house')).toContain('count(DISTINCT "id")');
    expect(metricProjection(['relationships'], 'relationship')).toContain('count(*)');
    expect(() => metricProjection(['population', 'houses'])).toThrow(/grain/);
  });
  it('executes safe character-to-house-to-dynasty aggregates and historical age metrics', () => {
    const filters: CohortFilters = { dynastyId: '5', houseId: '', status: 'Both', sex: 'All' };
    const sql = analyticalQuerySql({ grain: 'character', metricIds: ['population', 'historical_age'], filters, scope: 'selected', groupBy: 'dynasty', historicalAgeDate: '850.1.1' });
    const row = connection.query(sql).get(0);
    expect(row?.group_id).toBe('5');
    expect(row?.group_name).toBe('Dynasty Five');
    expect(Number(row?.population)).toBe(2);
    expect(Number(row?.historical_age_count)).toBe(2);
    expect(Number(row?.mean_historical_age)).toBe(25);
  });
  it('executes many-to-many trait and relationship queries without inflating character metrics', () => {
    const filters: CohortFilters = { dynastyId: '5', houseId: '', status: 'Both', sex: 'All' };
    const query = { filters, scope: 'selected' as const, groupBy: 'house' as const };
    const character = connection.query(analyticalQuerySql({ ...query, grain: 'character', metricIds: ['population', 'age'], traitId: '0' })).get(0);
    expect(Number(character?.population)).toBe(1);
    expect(Number(character?.age_count)).toBe(1);
    expect(Number(character?.mean_age)).toBe(50);
    const traits = connection.query(analyticalQuerySql({ ...query, grain: 'trait', metricIds: ['traits'] })).get(0);
    expect(Number(traits?.traits)).toBe(2);
    const links = connection.query(analyticalQuerySql({ ...query, grain: 'relationship', metricIds: ['relationships'] })).get(0);
    expect(Number(links?.relationships)).toBe(3);
    const relations = connection.query(analyticalQuerySql({ ...query, grain: 'character', metricIds: ['population'], relation: 'father' })).get(0);
    expect(Number(relations?.population)).toBe(1);
  });
  it('aggregates house, dynasty and title grains with independently scoped world cohorts', () => {
    const filters: CohortFilters = { dynastyId: '5', houseId: '2', status: 'Both', sex: 'All' };
    const selected = connection.query(analyticalQuerySql({ filters, scope: 'selected', grain: 'title', metricIds: ['titles'] })).get(0);
    expect(Number(selected?.titles)).toBe(2);
    const worldHouses = connection.query(analyticalQuerySql({ filters, scope: 'world', grain: 'house', metricIds: ['houses'] })).get(0);
    expect(Number(worldHouses?.houses)).toBe(2);
    const restDynasties = connection.query(analyticalQuerySql({ filters, scope: 'rest', grain: 'dynasty', metricIds: ['dynasties'] })).get(0);
    expect(Number(restDynasties?.dynasties)).toBe(1);
    expect(() => analyticalQuerySql({ filters, scope: 'world', grain: 'house', metricIds: ['population'] })).toThrow(/grain/);
    expect(() => analyticalQuerySql({ filters, scope: 'world', grain: 'character', metricIds: ['historical_age'] })).toThrow(/requires a date/);
  });
  it('executes every dashboard section and deduplicates trait prevalence and drilldown', () => {
    const filters: CohortFilters = { dynastyId: '5', houseId: '', status: 'Both', sex: 'All' };
    for (const section of ['overview', 'demographics', 'culture', 'traits', 'skills', 'houses'] as DashboardSection[]) {
      const queries = dashboardQueries({ filters, section, drill: null });
      for (const sql of Object.values(queries)) connection.query(sql);
    }
    const queries = dashboardQueries({ filters, section: 'traits', drill: { kind: 'trait', value: '0', label: 'brave' } });
    expect(Number(connection.query(queries.trait).get(0)?.n)).toBe(1);
    expect(Number(connection.query(queries.drill_count).get(0)?.n)).toBe(1);
  });
  it('applies age filters equally to dashboard cohorts and independent world comparisons', () => {
    const filters: CohortFilters = { dynastyId: '5', houseId: '2', status: 'Both', sex: 'All', minAge: 50, maxAge: 60 };
    const queries = dashboardQueries({ filters, section: 'skills', drill: null });
    const cohorts = connection.query(queries.cohorts).toArray();
    expect(cohorts.map(r => [r.cohort, Number(r.population)])).toEqual([['selected', 2], ['world', 2], ['rest', 0]]);
    expect(() => dashboardQueries({ filters: { ...filters, minAge: 70 }, section: 'overview', drill: null })).toThrow(/Minimum age/);
  });
  it('reconstructs known living members and supports safe category drilldowns', () => {
    const filters: CohortFilters = { dynastyId: '5', houseId: '', status: 'Both', sex: 'All' };
    const history = dashboardQueries({ filters, section: 'demographics', drill: null });
    const year850 = connection.query(history.history).toArray().find(row => Number(row.year) === 850);
    expect(Number(year850?.n)).toBe(2);
    expect(Number(year850?.unknown)).toBe(0);
    const birth = dashboardQueries({ filters, section: 'demographics', drill: { kind: 'birth', value: '850', label: '850s' } });
    expect(Number(connection.query(birth.drill_count).get(0)?.n)).toBe(1);
    const house = dashboardQueries({ filters, section: 'houses', drill: { kind: 'house', value: "2' OR TRUE --", label: 'test' } });
    expect(Number(connection.query(house.drill_count).get(0)?.n)).toBe(0);
    expect(() => dashboardQueries({ filters, section: 'demographics', drill: { kind: 'birth', value: '850 OR TRUE', label: 'invalid' } })).toThrow(/Invalid decade/);
  });
  it('resolves religion hierarchy IDs and counts each character once at each level', () => {
    const filters: CohortFilters = { dynastyId: '5', houseId: '', status: 'Both', sex: 'All' };
    const queries = dashboardQueries({ filters, section: 'culture', drill: { kind: 'faith', value: '12', label: 'Faith Twelve' } });
    const hierarchy = connection.query(queries.hierarchy).toArray();
    const rite = hierarchy.find(r => Number(r.level) === 3 && r.rite_id === '11');
    expect([rite?.religion_id, rite?.faith_id, rite?.religion, rite?.faith, rite?.rite, Number(rite?.n)]).toEqual(['13', '12', 'Religion Thirteen', 'Faith Twelve', 'Rite Eleven', 1]);
    expect([rite?.rite_key, rite?.color]).toEqual(['rite_11', '#0c2238']);
    expect(hierarchy.find(r => Number(r.level) === 2 && r.faith_id === '12')?.color).toBe('#cccc99');
    expect(Number(connection.query(queries.drill_count).get(0)?.n)).toBe(1);
    const secondPage = dashboardQueries({ filters, section: 'culture', drill: { kind: 'faith', value: '12', label: 'Faith Twelve' }, page: 1 });
    expect(connection.query(secondPage.drill).numRows).toBe(0);
    const differentHouse = dashboardQueries({ filters, section: 'culture', drill: { kind: 'faith', value: '12', label: 'Faith Twelve', houseId: '3' } });
    expect(Number(connection.query(differentHouse.drill_count).get(0)?.n)).toBe(0);
    const livingHouse = dashboardQueries({ filters, section: 'houses', drill: { kind: 'house', value: '2', label: 'House Two · Living', status: 'Living' } });
    expect(Number(connection.query(livingHouse.drill_count).get(0)?.n)).toBe(1);
    const rulingHouse = dashboardQueries({ filters, section: 'houses', drill: { kind: 'house', value: '2', label: 'House Two · rulers', ruler: 'Ruler' } });
    expect(Number(connection.query(rulingHouse.drill_count).get(0)?.n)).toBe(1);
    const skill = dashboardQueries({ filters, section: 'skills', drill: { kind: 'skill', skill: 'diplomacy', value: '1', label: 'Diplomacy 1' } });
    expect(Number(connection.query(skill.drill_count).get(0)?.n)).toBe(1);
    expect(() => dashboardQueries({ filters, section: 'skills', drill: { kind: 'skill', skill: 'id', value: '1', label: 'invalid' } })).toThrow(/Invalid skill/);
    for (const pillar of ['heritage', 'language'] as const) {
      const hierarchy = connection.query(queries[`${pillar}_hierarchy`]).toArray();
      expect(hierarchy.filter(r => Number(r.level) === 1).reduce((sum, r) => sum + Number(r.n), 0)).toBe(2);
      expect(hierarchy.find(r => Number(r.level) === 2 && r.culture_id === '1')?.parent_id).toBe(pillar === 'heritage' ? 'heritage_frankish' : 'language_french');
      const drill = dashboardQueries({ filters, section: 'culture', drill: { kind: pillar, value: pillar === 'heritage' ? 'heritage_frankish' : 'language_french', label: pillar } });
      expect(Number(connection.query(drill.drill_count).get(0)?.n)).toBe(1);
    }
  });
});
