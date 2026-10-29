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
export const skillNames = ['diplomacy', 'martial', 'stewardship', 'intrigue', 'learning', 'prowess'] as const;
export const numericColumns = ['age', 'skill_0', 'skill_1', 'skill_2', 'skill_3', 'skill_4', 'skill_5', 'birth_key', 'death_key', 'snapshot_date_key', 'count', 'input_count', 'recognized_count'];
export const percentage = (count: number, denominator: number): number | null =>
  Number.isFinite(count) && Number.isFinite(denominator) && denominator > 0 ? count * 100 / denominator : null;
const numeric = (value: unknown): number | null => {
  const raw = text(value);
  if (raw === null || raw.trim() === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
};

export function savedRgb(value: unknown): string | null {
  if (!isObject(value) || !Array.isArray(value.rgb) || value.rgb.length !== 3) return null;
  const channels = value.rgb.map(numeric);
  if (channels.some(channel => channel === null || !Number.isInteger(channel) || channel < 0 || channel > 255)) return null;
  return `#${channels.map(channel => Number(channel).toString(16).padStart(2, '0')).join('')}`;
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

export function normalize(data: Record<string, unknown>, localization?: Localization, definitions?: GameDefinitions): Snapshot {
  const nonBlank = (value: unknown) => {
    const raw = text(value);
    return raw !== null && raw.trim() ? raw : null;
  };
  const label = (value: unknown) => {
    const raw = nonBlank(value);
    return raw === null ? null : localization ? localization.resolve(raw) : raw;
  };
  const traitLabel = (value: string | null) => value === null ? null :
    localization?.lookup(`trait_${value}`) ?? label(value);
  const nestedName = (record: Record<string, unknown>) => {
    const nested = isObject(record.data) ? record.data : {};
    return nonBlank(record.name) ?? nonBlank(nested.name);
  };
  const date = text(data.date);
  const snapshotDate = parseDate(date);
  const metadata = isObject(data.meta_data) ? data.meta_data : {};
  const dynastyRoot = isObject(data.dynasties) ? data.dynasties : {};
  const houses = records(dynastyRoot.dynasty_house);
  const dynasties = records(dynastyRoot.dynasties);
  const houseById = new Map(houses);
  const dynastyById = new Map(dynasties);
  const withPrefix = (name: string | null, prefix: unknown) => {
    const key = text(prefix);
    const resolved = key ? localization?.lookup(key) ?? (!key.includes('_') && /[\s'-]/.test(key) ? key : null) : null;
    return name && resolved ? `${resolved}${name}` : name;
  };
  const dynastyName = (dynasty: Record<string, unknown>, id: string) => {
    const explicit = nonBlank(dynasty.localized_name) ?? nestedName(dynasty);
    const key = text(dynasty.key);
    const definition = key ? definitions?.dynasties.get(key) : undefined;
    const founding = houseById.get(id);
    const foundingKey = founding && text(founding.dynasty) === id ? text(founding.key) : null;
    const foundingName = founding && text(founding.dynasty) === id
      ? nonBlank(founding.localized_name) ?? nonBlank(founding.name) ?? (foundingKey ? definitions?.houses.get(foundingKey)?.name : null)
      : null;
    return label(explicit) ?? label(foundingName) ?? label(definition?.name) ?? (key ? localization?.lookup(key) ?? null : null);
  };
  const dynastyLabel = (dynasty: Record<string, unknown>, id: string) => {
    const founding = houseById.get(id);
    const definition = definitions?.dynasties.get(text(dynasty.key) ?? '');
    return withPrefix(dynastyName(dynasty, id), dynasty.prefix ?? (founding && text(founding.dynasty) === id ? founding.prefix : null) ?? definition?.prefix);
  };
  const houseLabel = (house: Record<string, unknown>, id: string) => {
    const explicit = nonBlank(house.localized_name) ?? nonBlank(house.name);
    const key = text(house.key);
    const definition = key ? definitions?.houses.get(key) : undefined;
    const dynastyId = text(house.dynasty);
    const dynasty = dynastyId === null ? undefined : dynastyById.get(dynastyId);
    const foundingName = dynasty && dynastyId === id ? dynastyName(dynasty, id) : null;
    const ownName = label(explicit) ?? label(definition?.name) ?? label(foundingName) ?? (key ? localization?.lookup(key) ?? key : null);
    if (ownName) return withPrefix(ownName, house.prefix ?? definition?.prefix ?? (foundingName && dynasty ? dynasty.prefix ?? definitions?.dynasties.get(text(dynasty.key) ?? '')?.prefix : null));
    return dynasty && dynastyId !== null ? withPrefix(dynastyName(dynasty, dynastyId), house.prefix ?? dynasty.prefix) : null;
  };
  const pillarLabel = (value: unknown) => {
    const key = nonBlank(value);
    return key ? localization?.lookup(`${key}_name`) ?? label(key) : null;
  };
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
  const religionById = new Map(religions);
  const titleHolders = new Set(titles.map(([, title]) => text(title.holder)).filter((id): id is string => id !== null));
  const traits = items(data.traits_lookup).map(text);
  const characters: Row[] = [], characterTraits: Row[] = [], relationships: Row[] = [];
  const fieldCounts = new Map<string, number>();
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
      for (const key of Object.keys(c)) {
        const path = `${section}/*/${key}`;
        fieldCounts.set(path, (fieldCounts.get(path) ?? 0) + 1);
      }
      const houseId = text(c.dynasty_house), house = houseId === null ? undefined : houseById.get(houseId);
      const dynastyId = house ? text(house.dynasty) : null;
      const dynasty = dynastyId === null ? undefined : dynastyById.get(dynastyId);
      const birth = text(c.birth), dead = isObject(c.dead_data) ? c.dead_data : {};
      const death = text(dead.date);
      const birthDate = parseDate(birth), deathDate = parseDate(death);
      const birthFuture = birthDate.key !== null && snapshotDate.key !== null && birthDate.key > snapshotDate.key;
      const deathFuture = deathDate.key !== null && snapshotDate.key !== null && deathDate.key > snapshotDate.key;
      const reversed = birthDate.key !== null && deathDate.key !== null && deathDate.key < birthDate.key;
      const inconsistent = birthFuture || deathFuture || reversed || (status === 'Living' && death !== null);
      const age = inconsistent ? null : ageAt(birth, status === 'Living' ? date : death);
      const cultureId = text(c.culture), culture = cultureId === null ? undefined : cultureById.get(cultureId);
      const riteId = text(c.rite), rite = riteId === null ? undefined : riteById.get(riteId);
      const faithId = rite ? text(rite.faith) : null, faith = faithId === null ? undefined : faithById.get(faithId);
      const skills = items(c.skill);
      characters.push({
        id, source_path: `${section}/${id}`, name: label(c.first_name), name_key: text(c.first_name), birth, death, status,
        birth_key: inconsistent ? null : birthDate.key, death_key: inconsistent ? null : deathDate.key,
        snapshot_date_key: snapshotDate.key, birth_quality: birthFuture ? 'after_snapshot' : birthDate.quality,
        death_quality: deathFuture ? 'after_snapshot' : reversed ? 'before_birth' : deathDate.quality,
        date_consistency: inconsistent ? 'inconsistent' : 'consistent',
        sex: c.female === 'yes' || c.female === true ? 'Female'
          : c.female === 'no' || c.female === false || (c.female === undefined && nonBlank(c.first_name) !== null && ['valid', 'placeholder'].includes(birthDate.quality)) ? 'Male' : 'Unknown',
        age, skill_0: numeric(skills[0]), skill_1: numeric(skills[1]), skill_2: numeric(skills[2]), skill_3: numeric(skills[3]), skill_4: numeric(skills[4]), skill_5: numeric(skills[5]),
        age_group: age === null ? 'Unknown' : age < 16 ? '0–15' : age < 30 ? '16–29' : age < 50 ? '30–49' : age < 70 ? '50–69' : '70+',
        house_id: houseId, house: houseId === null ? null : house ? houseLabel(house, houseId) ?? `House ${houseId}` : `Unresolved house ${houseId}`,
        dynasty_id: dynastyId, dynasty: dynastyId === null ? null : dynasty ? dynastyLabel(dynasty, dynastyId) ?? `Dynasty ${dynastyId}` : `Unresolved dynasty ${dynastyId}`,
        culture_id: cultureId, culture: cultureId === null ? null : culture ? label(nestedName(culture) ?? culture.culture_template) ?? `Culture ${cultureId}` : `Unresolved culture ${cultureId}`,
        heritage_key: culture ? text(culture.heritage) : null, heritage: culture ? pillarLabel(culture.heritage) : null,
        language_key: culture ? text(culture.language) : null, language: culture ? pillarLabel(culture.language) : null,
        rite_id: riteId, faith_id: faithId,
        faith: faithId === null ? (riteId === null ? null : `Unresolved rite ${riteId}`) : faith ? label(nestedName(faith) ?? faith.tag) ?? `Faith ${faithId}` : `Unresolved faith ${faithId}`,
        rite: riteId === null ? null : rite ? label(nestedName(rite) ?? rite.rite_type) ?? `Rite ${riteId}` : `Unresolved rite ${riteId}`,
        religion_id: faith ? text(faith.religion) : null,
        landed: isObject(c.landed_data) || titleHolders.has(id) ? 'Yes' : 'Unknown',
        ruler_status: isObject(c.landed_data) || titleHolders.has(id) ? 'Ruler' : 'Unknown',
      });
      for (const trait of items(c.traits)) {
        const traitId = text(trait);
        if (traitId === null) continue;
        const index = Number(traitId);
        characterTraits.push({ character_id: id, trait_id: traitId, trait: Number.isInteger(index) && traits[index] ? traitLabel(traits[index]) : `Unresolved trait ${traitId}`, source_path: `${section}/${id}/traits` });
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
  const recordedFathers = new Set(relationships.filter(row => row.relation === 'father').map(row => row.character_id));
  const recordedMothers = new Set(relationships.filter(row => row.relation === 'mother').map(row => row.character_id));
  const sections: [string, unknown][] = [
    ['living', data.living], ['dead_unprunable', data.dead_unprunable],
    ['dynasties/dynasty_house', dynastyRoot.dynasty_house], ['dynasties/dynasties', dynastyRoot.dynasties],
    ['culture_manager/cultures', culturesRoot.cultures], ['faiths/database', faithRoot.database],
    ['rites/database', riteRoot.database], ['religion/religions', religionRoot.religions],
    ['landed_titles/landed_titles', titleRoot.landed_titles],
  ];
  return {
    date, warnings,
    tables: {
      save_metadata: [{ source_path: 'meta_data', date, version: text(metadata.version), save_game_version: text(metadata.save_game_version), meta_date: text(metadata.meta_date), ironman: text(metadata.ironman) }],
      characters,
      dynasties: dynasties.map(([id, d]) => ({ id, source_path: `dynasties/dynasties/${id}`, key: text(d.key), name: dynastyLabel(d, id), name_source: nestedName(d), localized_name: text(d.localized_name), prefix_key: text(d.prefix), head_id: text(d.dynasty_head) })),
      houses: houses.map(([id, h]) => ({ id, source_path: `dynasties/dynasty_house/${id}`, name: houseLabel(h, id), name_key: text(h.name), localized_name: text(h.localized_name), key: text(h.key), prefix_key: text(h.prefix), dynasty_id: text(h.dynasty), head_id: text(h.head_of_house), found_date: text(h.found_date) })),
      cultures: cultures.map(([id, c]) => ({ id, source_path: `culture_manager/cultures/${id}`, name: label(nestedName(c) ?? c.culture_template), name_source: nestedName(c), key: text(c.culture_template), heritage_key: text(c.heritage), heritage: pillarLabel(c.heritage), language_key: text(c.language), language: pillarLabel(c.language) })),
      faiths: faiths.map(([id, f]) => ({ id, source_path: `faiths/database/${id}`, name: label(nestedName(f) ?? f.tag), name_source: nestedName(f), religion_id: text(f.religion), tag: text(f.tag), color: savedRgb(f.color ?? (isObject(f.data) ? f.data.color : null)) })),
      religions: religions.map(([id, r]) => ({ id, source_path: `religion/religions/${id}`, name: label(nestedName(r) ?? r.tag ?? r.religion_type), name_source: nestedName(r), tag: text(r.tag ?? r.religion_type) })),
      rites: rites.map(([id, r]) => ({ id, source_path: `rites/database/${id}`, name: label(nestedName(r) ?? r.rite_type), name_source: nestedName(r), key: text(r.rite_type), faith_id: text(r.faith), color: savedRgb((isObject(r.data) ? r.data.color : null) ?? r.color) })),
      titles: titles.map(([id, t]) => ({ id, source_path: `landed_titles/landed_titles/${id}`, key: text(t.key), name: label((isObject(t.title_name_data) ? text(t.title_name_data.name) : null) ?? t.key), holder_id: text(t.holder) })),
      title_history: titles.flatMap(([id, t]) => isObject(t.history) ? Object.entries(t.history).flatMap(([dateKey, holder]) =>
        items(holder).map(text).filter((value): value is string => value !== null).map(holderId => ({
          title_id: id, date: dateKey, holder_id: holderId, source_path: `landed_titles/landed_titles/${id}/history/${dateKey}`,
        }))) : []),
      character_traits: characterTraits, relationships,
      traits: traits.map((name, id) => ({ id: String(id), name: traitLabel(name), key: name })),
      import_diagnostics: [
        ...[['living', data.living], ['dead_unprunable', data.dead_unprunable], ['houses', dynastyRoot.dynasty_house], ['dynasties', dynastyRoot.dynasties], ['cultures', culturesRoot.cultures], ['faiths', faithRoot.database], ['rites', riteRoot.database], ['religions', religionRoot.religions], ['titles', titleRoot.landed_titles]].map(([section, source]) => ({
          issue: `${section} invalid or ambiguous records omitted`, count: isObject(source) ? Object.keys(source).length - records(source).length : 0,
        })),
        { issue: 'characters with unresolved house', count: characters.filter(c => c.house_id !== null && !houseById.has(String(c.house_id))).length },
        { issue: 'characters with unresolved culture', count: characters.filter(c => c.culture_id !== null && !cultureById.has(String(c.culture_id))).length },
        { issue: 'houses with unresolved dynasty', count: houses.filter(([, h]) => h.dynasty != null && !dynastyById.has(String(h.dynasty))).length },
        { issue: 'faiths with unresolved religion', count: faiths.filter(([, f]) => f.religion != null && !religionById.has(String(f.religion))).length },
        { issue: 'rites with unresolved faith', count: rites.filter(([, r]) => r.faith != null && !faithById.has(String(r.faith))).length },
        { issue: 'current title holders absent from parsed characters', count: titles.filter(([, t]) => t.holder != null && !seen.has(String(t.holder))).length },
        { issue: 'characters with unresolved rite', count: characters.filter(c => c.rite_id !== null && !riteById.has(String(c.rite_id))).length },
        { issue: 'characters with unresolved faith', count: characters.filter(c => c.faith_id !== null && !faithById.has(String(c.faith_id))).length },
        { issue: 'character trait links with unresolved lookup', count: characterTraits.filter(t => String(t.trait).startsWith('Unresolved trait ')).length },
        { issue: 'characters with missing or invalid age', count: characters.filter(c => c.age === null).length },
        { issue: 'character relationships to absent records', count: relationships.filter(r => !seen.has(String(r.relative_id))).length },
        { issue: 'characters without recorded father link', count: characters.filter(c => !recordedFathers.has(c.id)).length },
        { issue: 'characters without recorded mother link', count: characters.filter(c => !recordedMothers.has(c.id)).length },
        ...(['missing', 'invalid', 'placeholder', 'after_snapshot'] as const).flatMap(quality => [
          { issue: `characters with ${quality} birth date`, count: characters.filter(c => c.birth_quality === quality).length },
          { issue: `deceased characters with ${quality} death date`, count: characters.filter(c => c.status === 'Deceased' && c.death_quality === quality).length },
        ]),
        { issue: 'characters with inconsistent dates', count: characters.filter(c => c.date_consistency === 'inconsistent').length },
        { issue: 'deceased characters with death before birth', count: characters.filter(c => c.status === 'Deceased' && c.death_quality === 'before_birth').length },
      ],
      source_field_coverage: [...fieldCounts].map(([source_path, count]) => ({
        source_path, count, normalized: ['first_name', 'birth', 'dead_data', 'female', 'skill', 'dynasty_house', 'culture', 'rite', 'traits', 'family_data', 'landed_data'].includes(source_path.split('/').pop() ?? '') ? 'partial or yes' : 'no',
      })),
      source_section_coverage: sections.map(([source_path, value]) => ({
        source_path, state: isObject(value) ? 'available' : value == null ? 'missing' : 'unsupported',
        input_count: isObject(value) ? Object.keys(value).length : null,
        recognized_count: isObject(value) ? records(value).length : null,
      })),
    },
  };
}
import type { Localization } from './localization';
import type { GameDefinitions } from './gameData';
import { ageAt, parseDate } from './dates';
export { ageAt } from './dates';
