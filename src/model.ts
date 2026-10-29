export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
export type Tables = Record<string, Row[]>;
export interface Snapshot {
  date: string | null;
  tables: Tables;
  warnings: string[];
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const text = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : null;
export const items = (value: unknown): unknown[] => value == null ? [] : Array.isArray(value) ? value : [value];
export const numericColumns = ['age', 'skill_0', 'skill_1', 'skill_2', 'skill_3', 'skill_4', 'skill_5'];
export const percentage = (count: number, denominator: number): number | null =>
  Number.isFinite(count) && Number.isFinite(denominator) && denominator > 0 ? count * 100 / denominator : null;
const numeric = (value: unknown): number | null => {
  const raw = text(value);
  if (raw === null || raw.trim() === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
};

export function ageAt(birth: string | null, end: string | null): number | null {
  const parse = (s: string | null) => {
    const m = s?.match(/^(-?\d+)\.(\d{1,2})\.(\d{1,2})$/);
    if (!m) return null;
    const [, y, mo, d] = m;
    const year = Number(y), month = Number(mo), day = Number(d);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
    return [year, month, day];
  };
  const a = parse(birth), b = parse(end);
  if (!a || !b) return null;
  const age = b[0] - a[0] - (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2]) ? 1 : 0);
  return age >= 0 ? age : null;
}

function records(value: unknown): [string, Record<string, unknown>][] {
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([id, record]) => {
    if (isObject(record)) return [[id, record] as [string, Record<string, unknown>]];
    if (Array.isArray(record) && record.length && record.every(x => isObject(x) && JSON.stringify(x) === JSON.stringify(record[0]))) {
      return [[id, record[0] as Record<string, unknown>] as [string, Record<string, unknown>]];
    }
    return [];
  });
}

export function normalize(data: Record<string, unknown>): Snapshot {
  const date = text(data.date);
  const metadata = isObject(data.meta_data) ? data.meta_data : {};
  const dynastyRoot = isObject(data.dynasties) ? data.dynasties : {};
  const houses = records(dynastyRoot.dynasty_house);
  const dynasties = records(dynastyRoot.dynasties);
  const houseById = new Map(houses);
  const dynastyById = new Map(dynasties);
  const culturesRoot = isObject(data.culture_manager) ? data.culture_manager : {};
  const cultures = records(culturesRoot.cultures);
  const cultureById = new Map(cultures);
  const faithRoot = isObject(data.faiths) ? data.faiths : {};
  const riteRoot = isObject(data.rites) ? data.rites : {};
  const religionRoot = isObject(data.religion) ? data.religion : {};
  const titleRoot = isObject(data.landed_titles) ? data.landed_titles : {};
  const faiths = records(faithRoot.database), rites = records(riteRoot.database);
  const religions = records(religionRoot.religions), titles = records(titleRoot.landed_titles);
  const faithById = new Map(faiths), riteById = new Map(rites);
  const titleHolders = new Set(titles.map(([, title]) => text(title.holder)).filter((id): id is string => id !== null));
  const traits = items(data.traits_lookup).map(text);
  const characters: Row[] = [], characterTraits: Row[] = [], relationships: Row[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const [section, status] of [['living', 'Living'], ['dead_unprunable', 'Deceased']] as const) {
    const source = data[section];
    if (!isObject(source)) continue;
    const converted = records(source);
    const dropped = Object.keys(source).length - converted.length;
    if (dropped) warnings.push(`${section}: ${dropped} ambiguous or invalid records omitted.`);
    for (const [id, c] of converted) {
      if (seen.has(id)) { warnings.push(`Character ${id} appears in multiple sections; later record omitted.`); continue; }
      seen.add(id);
      const houseId = text(c.dynasty_house), house = houseId === null ? undefined : houseById.get(houseId);
      const dynastyId = house ? text(house.dynasty) : null;
      const dynasty = dynastyId === null ? undefined : dynastyById.get(dynastyId);
      const birth = text(c.birth), dead = isObject(c.dead_data) ? c.dead_data : {};
      const age = ageAt(birth, status === 'Living' ? date : text(dead.date));
      const cultureId = text(c.culture), culture = cultureId === null ? undefined : cultureById.get(cultureId);
      const riteId = text(c.rite), rite = riteId === null ? undefined : riteById.get(riteId);
      const faithId = rite ? text(rite.faith) : null, faith = faithId === null ? undefined : faithById.get(faithId);
      const skills = items(c.skill);
      characters.push({
        id, source_path: `${section}/${id}`, name: text(c.first_name), birth, death: text(dead.date), status,
        sex: c.female === 'yes' || c.female === true ? 'Female' : c.female === 'no' || c.female === false ? 'Male' : 'Unknown',
        age, skill_0: numeric(skills[0]), skill_1: numeric(skills[1]), skill_2: numeric(skills[2]), skill_3: numeric(skills[3]), skill_4: numeric(skills[4]), skill_5: numeric(skills[5]),
        age_group: age === null ? 'Unknown' : age < 16 ? '0–15' : age < 30 ? '16–29' : age < 50 ? '30–49' : age < 70 ? '50–69' : '70+',
        house_id: houseId, house: houseId === null ? null : house ? text(house.name) ?? `House ${houseId}` : `Unresolved house ${houseId}`,
        dynasty_id: dynastyId, dynasty: dynastyId === null ? null : dynasty ? `Dynasty ${dynastyId}` : `Unresolved dynasty ${dynastyId}`,
        culture_id: cultureId, culture: cultureId === null ? null : culture ? text(culture.culture_template) ?? `Culture ${cultureId}` : `Unresolved culture ${cultureId}`,
        rite_id: riteId, faith_id: faithId,
        faith: faithId === null ? (riteId === null ? null : `Unresolved rite ${riteId}`) : faith ? text(faith.name) ?? text(faith.tag) ?? `Faith ${faithId}` : `Unresolved faith ${faithId}`,
        landed: isObject(c.landed_data) || titleHolders.has(id) ? 'Yes' : 'Unknown',
      });
      for (const trait of items(c.traits)) {
        const traitId = text(trait);
        if (traitId === null) continue;
        const index = Number(traitId);
        characterTraits.push({ character_id: id, trait_id: traitId, trait: Number.isInteger(index) && traits[index] ? traits[index] : `Unresolved trait ${traitId}`, source_path: `${section}/${id}/traits` });
      }
      const family = isObject(c.family_data) ? c.family_data : {};
      for (const kind of ['father', 'mother', 'spouse', 'child']) {
        for (const relative of items(family[kind])) {
          const relativeId = text(relative);
          if (relativeId !== null) relationships.push({ character_id: id, relation: kind, relative_id: relativeId, source_path: `${section}/${id}/family_data/${kind}`, derived: 'no' });
        }
      }
    }
  }
  const inferredParents = new Set<string>();
  for (const link of relationships.filter(row => row.relation === 'child')) {
    const child = String(link.relative_id), parent = String(link.character_id), key = `${child}\0${parent}`;
    if (inferredParents.has(key)) continue;
    inferredParents.add(key);
    relationships.push({ character_id: child, relation: 'parent', relative_id: parent, source_path: link.source_path, derived: 'yes' });
  }
  return {
    date, warnings,
    tables: {
      save_metadata: [{ source_path: 'meta_data', date, version: text(metadata.version), save_game_version: text(metadata.save_game_version), meta_date: text(metadata.meta_date), ironman: text(metadata.ironman) }],
      characters,
      dynasties: dynasties.map(([id, d]) => ({ id, source_path: `dynasties/dynasties/${id}`, key: text(d.key) })),
      houses: houses.map(([id, h]) => ({ id, source_path: `dynasties/dynasty_house/${id}`, name: text(h.name), dynasty_id: text(h.dynasty) })),
      cultures: cultures.map(([id, c]) => ({ id, source_path: `culture_manager/cultures/${id}`, name: text(c.culture_template) })),
      faiths: faiths.map(([id, f]) => ({ id, source_path: `faiths/database/${id}`, name: text(f.name), religion_id: text(f.religion), tag: text(f.tag) })),
      religions: religions.map(([id, r]) => ({ id, source_path: `religion/religions/${id}`, name: text(r.tag) })),
      rites: rites.map(([id, r]) => ({ id, source_path: `rites/database/${id}`, name: text(r.rite_type), faith_id: text(r.faith) })),
      titles: titles.map(([id, t]) => ({ id, source_path: `landed_titles/landed_titles/${id}`, key: text(t.key), holder_id: text(t.holder) })),
      character_traits: characterTraits, relationships,
      traits: traits.map((name, id) => ({ id: String(id), name })),
    },
  };
}
