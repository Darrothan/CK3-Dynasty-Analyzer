import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { Jomini } from 'jomini';
import { extractGamestate } from './import';
import { ageAt, normalize, percentage, savedRgb } from './model';
import { createLocalization, normalizeSearch } from './localization';
import { cohortSql } from './analytics';
import { addDefinitions, emptyDefinitions, selectedGameFiles } from './gameData';

const fixture = `date=867.1.1
meta_data={ version="1.20" ironman=no }
traits_lookup={ first second third }
living={
36959={
 first_name="GuillE_n" birth=831.7.26 culture=81 dynasty_house=2 rite=7
 skill={ 10 4 6 9 6 1 } traits={ 1 2 }
 alive_data={ fertility=0.55707 health=4.01756 }
 family_data={ spouse=9 spouse=10 child={ 11 12 } }
}
}
dynasties={ dynasty_house={ 2={ name="Maison é" dynasty=5 } } dynasties={ 5={ key=example } } }
culture_manager={ cultures={ 81={ culture_template=iberian } } }
rites={ database={ 7={ faith=3 } } }
faiths={ database={ 3={ name="Faith name" religion=4 } } }
religion={ religions={ 4={ tag=faith_family } } }
landed_titles={ landed_titles={ 10={ key=k_example holder=36959 } } }
dead_unprunable={ 22={ first_name="Dead" birth=800.1.1 dead_data={ date=850.2.1 } dynasty_house=99 } }
`;
const encode = (s: string) => strToU8(s);

describe('save input', () => {
  it('accepts plaintext UTF-8', () => expect(extractGamestate(encode(fixture))).toEqual(encode(fixture)));
  it('extracts ZIP and a header-prefixed ZIP', () => {
    const zip = zipSync({ gamestate: encode(fixture), meta: encode('metadata') });
    expect(extractGamestate(zip)).toEqual(encode(fixture));
    const prefix = encode('SAVE0102 header\n');
    const prefixed = new Uint8Array(prefix.length + zip.length);
    prefixed.set(prefix); prefixed.set(zip, prefix.length);
    expect(extractGamestate(prefixed)).toEqual(encode(fixture));
  });
  it('rejects missing gamestate, corrupt archive, binary and empty content', () => {
    expect(() => extractGamestate(zipSync({ meta: encode('x') }))).toThrow(/gamestate/);
    expect(() => extractGamestate(new Uint8Array([80, 75, 3, 4, 1, 2]))).toThrow(/extract/);
    expect(() => extractGamestate(new Uint8Array([1, 0, 2]))).toThrow(/Binary/);
    expect(() => extractGamestate(new Uint8Array())).toThrow(/empty/);
    expect(() => extractGamestate(encode('x={ test=1'))).toThrow(/incomplete/);
  });
});

describe('Jomini and normalized data', () => {
  it('parses nested data, repeated keys, arrays, numbers and non-ASCII text', async () => {
    const parser = await Jomini.initialize();
    const parsed = parser.parseText(extractGamestate(encode(fixture)), { typeNarrowing: 'none' });
    expect(parsed.living['36959'].skill).toEqual(['10', '4', '6', '9', '6', '1']);
    expect(parsed.living['36959'].family_data.spouse).toEqual(['9', '10']);
    expect(parsed.living['36959'].alive_data.health).toBe('4.01756');
    expect(parsed.dynasties.dynasty_house['2'].name).toBe('Maison é');
    const result = normalize(parsed);
    expect(result.tables.save_metadata[0]).toMatchObject({ date: '867.1.1', version: '1.20', ironman: 'no' });
    const character = result.tables.characters.find(c => c.id === '36959');
    expect(character).toMatchObject({ name: 'GuillE_n', house_id: '2', dynasty_id: '5', culture: 'iberian', faith_id: '3', faith: 'Faith name', age: 35, skill_0: 10, skill_5: 1, status: 'Living' });
    expect(result.tables.titles[0]).toMatchObject({ id: '10', holder_id: '36959' });
    expect(result.tables.character_traits).toMatchObject([
      { character_id: '36959', trait_id: '1', trait: 'second' },
      { character_id: '36959', trait_id: '2', trait: 'third' },
    ]);
    expect(result.tables.relationships.filter(r => r.character_id === '36959')).toHaveLength(4);
    expect(result.tables.relationships.find(r => r.character_id === '11' && r.relation === 'parent')).toMatchObject({ relative_id: '36959', derived: 'yes' });
    expect(result.tables.characters.find(c => c.id === '22')).toMatchObject({ house: 'Unresolved house 99', dynasty_id: null, age: 50 });
    expect(new Set(result.tables.characters.map(c => c.id)).size).toBe(2);
  });
  it('does not silently invent dates or ages', () => {
    expect(ageAt('831.7.26', '867.1.1')).toBe(35);
    expect(ageAt('831.7.26', '867.7.26')).toBe(36);
    expect(ageAt(null, '867.1.1')).toBeNull();
    expect(ageAt('831.2.30', '867.1.1')).toBeNull();
    expect(ageAt('900.1.1', '867.1.1')).toBeNull();
  });
  it('uses the filtered population as percentage denominator', () => {
    expect(percentage(3, 12)).toBe(25);
    expect(percentage(0, 12)).toBe(0);
    expect(percentage(0, 0)).toBeNull();
  });
  it('keeps nested names, heads, title history, and invalid future deaths with source IDs', () => {
    const result = normalize({
      date: '867.1.1',
      living: { a: { dynasty_house: '2', rite: '7', traits: ['9'] } },
      dead_unprunable: { b: { birth: '800.1.1', dead_data: { date: '9999.1.1' } } },
      dynasties: { dynasty_house: { 2: { name: 'dynn_Example', dynasty: '5', head_of_house: 'a', prefix: 'dynnp_de' } }, dynasties: { 5: { dynasty_head: 'a' } } },
      rites: { database: { 7: { faith: '3', data: { name: 'Custom Rite' } } } },
      faiths: { database: { 3: { data: { name: 'Custom Faith' }, religion: '4' } } },
      landed_titles: { landed_titles: { 1: { key: 'k_example', history: { '800.1.1': ['a', 'b'] } } } },
    });
    expect(result.tables.characters[0]).toMatchObject({ rite: 'Custom Rite', faith: 'Custom Faith', religion_id: '4' });
    expect(result.tables.characters[1].age).toBeNull();
    expect(result.tables.houses[0]).toMatchObject({ head_id: 'a', prefix_key: 'dynnp_de' });
    expect(result.tables.dynasties[0].head_id).toBe('a');
    expect(result.tables.title_history).toHaveLength(2);
    expect(result.tables.import_diagnostics.find(r => r.issue === 'character trait links with unresolved lookup')?.count).toBe(1);
  });
});

describe('localization and cohorts', () => {
  it('selects only English and relevant definitions from a full game directory', () => {
    const files = ['game/localization/english/religion/a.yml', 'game/localization/french/a.yml', 'game/common/dynasty_houses/a.txt', 'game/common/dynasties/b.txt', 'game/common/culture/cultures/a.txt', 'game/gfx/a.dds'].map(path => ({ name: path.split('/').pop()!, webkitRelativePath: path }));
    expect(selectedGameFiles(files).map(f => f.webkitRelativePath)).toEqual([files[0].webkitRelativePath, files[2].webkitRelativePath, files[3].webkitRelativePath]);
    expect(selectedGameFiles([{ name: 'names.yml', webkitRelativePath: 'english/dynasties/names.yml' }])).toHaveLength(1);
  });
  it('resolves founding and branch house templates and recorded culture pillars', () => {
    const definitions = emptyDefinitions();
    addDefinitions(definitions, 'game/common/dynasty_houses/houses.txt', { house_branch: { name: 'dynn_Branch', prefix: 'dynnp_de' } });
    addDefinitions(definitions, 'game/common/dynasty_houses/numbered.txt', { 12319: { name: 'dynn_Branch' } });
    addDefinitions(definitions, 'game/common/dynasties/dynasties.txt', { 25061: { name: 'dynn_Karling' } });
    const loc = createLocalization([{ path: 'a.yml', content: 'l_english:\n dynn_Karling: "Karling"\n dynn_Branch: "Branch"\n dynnp_de: "de "\n heritage_frankish_name: "Frankish heritage"\n language_frankish_name: "Frankish language"\n christianity_religion: "Christianity"\n' }]);
    const source = {
      date: '867.1.1', living: { a: { first_name: 'A', birth: '850.1.1', dynasty_house: '9', culture: '4' } },
      dynasties: { dynasty_house: { 5: { name: 'dynn_Karling', dynasty: '5' }, 9: { key: 'house_branch', dynasty: '5' }, 10: { key: 'house_unknown', dynasty: '5' }, 11: { key: '12319', dynasty: '5' }, 12: { key: '99999999', dynasty: '5' } }, dynasties: { 5: { key: '25061' } } },
      culture_manager: { cultures: { 4: { name: 'frankish', heritage: 'heritage_frankish', language: 'language_frankish' } } },
      religion: { religions: { 1: { tag: 'christianity_religion' } } },
    };
    const snapshot = normalize(source, loc, definitions);
    expect(snapshot.tables.dynasties[0].name).toBe('Karling');
    expect(snapshot.tables.houses.map(h => h.name)).toEqual(['Karling', 'de Branch', 'house_unknown', 'Branch', '99999999']);
    expect(snapshot.tables.characters[0]).toMatchObject({ dynasty: 'Karling', house: 'de Branch', heritage_key: 'heritage_frankish', heritage: 'Frankish heritage', language: 'Frankish language' });
    expect(snapshot.tables.religions[0].name).toBe('Christianity');
    expect(normalize(source).tables.houses[1].name).toBe('house_branch');
  });
  it('uses the game definition for a founding house without borrowing names for unresolved branches', () => {
    const definitions = emptyDefinitions();
    addDefinitions(definitions, 'game/common/dynasties/a.txt', { 25061: { name: 'dynn_Karling', prefix: 'dynnp_de' } });
    const loc = createLocalization([{ path: 'a.yml', content: 'l_english:\n dynn_Karling: "Karling"\n dynnp_de: "de "\n' }]);
    const snapshot = normalize({ dynasties: { dynasty_house: { 5: { key: '25061', dynasty: '5' }, 6: { key: '123456', dynasty: '5' } }, dynasties: { 5: { key: '25061' } } } }, loc, definitions);
    expect(snapshot.tables.dynasties[0].name).toBe('de Karling');
    expect(snapshot.tables.houses.map(h => h.name)).toEqual(['de Karling', '123456']);
  });
  it('accepts valid save RGB values and does not invent malformed colors', () => {
    expect(savedRgb({ rgb: ['204', '204', '153'] })).toBe('#cccc99');
    expect(savedRgb({ rgb: ['0', '15', '255'] })).toBe('#000fff');
    expect(savedRgb({ rgb: ['256', '0', '0'] })).toBeNull();
    expect(savedRgb({ rgb: ['1', '2'] })).toBeNull();
    expect(savedRgb({ hsv: ['1', '2', '3'] })).toBeNull();
  });
  it('uses sorted file precedence, references, markup, UTF-8, and safe fallbacks', () => {
    const localization = createLocalization([
      { path: 'b.yml', content: 'l_english:\n name:1 "$prefix$Émile"\n prefix:0 "de "\n dynamic:0 "[Character.GetName]"\n cycle:0 "$cycle$"\n' },
      { path: 'a.yml', content: '\uFEFFl_english:\n name:0 "Old"\n decorated:0 "#bold Localized#!"\n' },
    ]);
    expect(localization.collisions).toBe(1);
    expect(localization.resolve('name')).toBe('de Émile');
    expect(localization.resolve('decorated')).toBe('Localized');
    expect(localization.resolve('dynamic')).toBe('dynamic');
    expect(localization.resolve('cycle')).toBe('cycle');
    expect(localization.resolve('Missing_Key')).toBe('Missing_Key');
    expect(localization.resolve('Direct name')).toBe('Direct name');
    expect(normalizeSearch('  ÉMILE  ')).toBe('emile');
  });
  it('builds separate eligible world cohorts without selected-house leakage', () => {
    const sql = cohortSql({ dynastyId: "5' OR 1=1 --", houseId: '2', status: 'Living', sex: 'Female' });
    const parts = sql.split(' UNION ALL ');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain("dynasty_id = '5'' OR 1=1 --'");
    expect(parts[0]).toContain("house_id = '2'");
    expect(parts[1]).not.toContain('dynasty_id');
    expect(parts[1]).not.toContain('house_id');
    expect(parts[2]).toContain('dynasty_id IS NULL');
    for (const part of parts) {
      expect(part).toContain("status = 'Living'");
      expect(part).toContain("sex = 'Female'");
      expect(part).toContain('count("age")');
    }
    expect(() => cohortSql({ dynastyId: '', houseId: '', status: 'Both', sex: 'All' })).toThrow(/dynasty/);
  });
  it('resolves each entity type from source names and CK3 trait-prefixed keys', () => {
    const loc = createLocalization([{ path: 'example.yml', content: `l_english:
 dynn_Test:0 "Test dynasty"
 dynnp_de:0 "de "
 castilian:0 "Castilian"
 akom_religion:0 "Akan"
 roman_rite:0 "Roman Rite"
 trait_brave:0 "Brave trait"
 brave:0 "Wrong namespace"
 k_test:0 "Test title"
` }]);
    const result = normalize({
      date: '867.1.1',
      living: { a: { dynasty_house: '2', culture: '4', rite: '7', traits: ['0'], birth: '850.1.1' } },
      dynasties: { dynasty_house: { 2: { dynasty: '5', name: 'dynn_Test', prefix: 'dynnp_de' } }, dynasties: { 5: { name: 'dynn_Test' } } },
      culture_manager: { cultures: { 4: { culture_template: 'other', data: { name: 'castilian' } } } },
      rites: { database: { 7: { faith: '3', rite_type: 'roman_rite' } } },
      faiths: { database: { 3: { religion: '8', data: { name: 'Custom Faith' } } } },
      religion: { religions: { 8: { tag: 'akom_religion' } } },
      traits_lookup: ['brave'],
      landed_titles: { landed_titles: { 9: { key: 'k_test' } } },
    }, loc);
    expect(result.tables.dynasties[0].name).toBe('Test dynasty');
    expect(result.tables.houses[0].name).toBe('de Test dynasty');
    expect(result.tables.cultures[0].name).toBe('Castilian');
    expect(result.tables.faiths[0].name).toBe('Custom Faith');
    expect(result.tables.religions[0].name).toBe('Akan');
    expect(result.tables.rites[0].name).toBe('Roman Rite');
    expect(result.tables.traits[0]).toMatchObject({ name: 'Brave trait', key: 'brave' });
    expect(result.tables.titles[0].name).toBe('Test title');
    expect(result.tables.characters[0]).toMatchObject({ dynasty: 'Test dynasty', culture: 'Castilian' });
  });
  it('reports unsupported fields, unresolved links, omitted records and temporal quality', () => {
    const result = normalize({
      date: '867.1.1',
      living: { a: { birth: '1.1.1', culture: '4', strange_mod_field: 'x', family_data: { father: 'missing' } }, broken: 'x' },
      dynasties: { dynasty_house: { 2: { dynasty: 'absent' } } },
      rites: { database: { 7: { faith: 'absent' } } },
    });
    const counts = Object.fromEntries(result.tables.import_diagnostics.map(r => [r.issue, r.count]));
    expect(counts['living invalid or ambiguous records omitted']).toBe(1);
    expect(counts['characters with placeholder birth date']).toBe(1);
    expect(counts['characters with unresolved culture']).toBe(1);
    expect(counts['houses with unresolved dynasty']).toBe(1);
    expect(counts['rites with unresolved faith']).toBe(1);
    expect(counts['character relationships to absent records']).toBe(1);
    expect(result.tables.source_field_coverage.find(r => r.source_path === 'living/*/strange_mod_field')).toMatchObject({ count: 1, normalized: 'no' });
    expect(result.tables.source_section_coverage.find(r => r.source_path === 'dead_unprunable')).toMatchObject({ state: 'missing', input_count: null });
    expect(result.tables.source_section_coverage.find(r => r.source_path === 'living')).toMatchObject({ state: 'available', input_count: 2, recognized_count: 1 });
  });
  it('uses omitted female as male only on complete records and preserves invalid values as unknown', () => {
    const result = normalize({ date: '867.1.1', living: {
      male: { first_name: 'Name', birth: '850.1.1' },
      female: { first_name: 'Name', birth: '850.1.1', female: 'yes' },
      explicit: { first_name: 'Name', birth: '850.1.1', female: 'no' },
      invalid: { first_name: 'Name', birth: '850.1.1', female: 'unexpected' },
      incomplete: { birth: '850.1.1' },
      malformed: { first_name: 'Name', birth: 'not-a-date' },
    } });
    expect(result.tables.characters.map(c => [c.id, c.sex])).toEqual([
      ['male', 'Male'], ['female', 'Female'], ['explicit', 'Male'], ['invalid', 'Unknown'], ['incomplete', 'Unknown'], ['malformed', 'Unknown'],
    ]);
  });
  it('resolves explicit localized house names and falls back only to a resolvable dynasty name', () => {
    const loc = createLocalization([{ path: 'a.yml', content: 'l_english:\n dynnp_de:0 "de "\n dynn_Test:0 "Test"\n house_named:0 "Branch"\n' }]);
    const result = normalize({
      living: { a: { first_name: 'A', birth: '800.1.1', dynasty_house: '1' } },
      dynasties: {
        dynasties: { 10: { name: 'dynn_Test', prefix: 'dynnp_de' }, 11: { key: '12345' } },
        dynasty_house: {
          1: { dynasty: '10' }, 2: { dynasty: '10', localized_name: 'Custom House' },
          3: { dynasty: '10', key: 'house_named' }, 4: { dynasty: '11' },
          5: { dynasty: '999' }, 6: { dynasty: '10', prefix: 'dynnp_de' },
          7: { dynasty: '10', prefix: 'von ' },
        },
      },
    }, loc);
    expect(result.tables.dynasties[0].name).toBe('de Test');
    expect(result.tables.houses.map(h => h.name)).toEqual(['de Test', 'Custom House', 'Branch', null, null, 'de Test', 'von Test']);
    expect(result.tables.houses[1]).toMatchObject({ name_key: null, localized_name: 'Custom House' });
    expect(result.tables.characters[0]).toMatchObject({ house: 'de Test', dynasty: 'de Test' });
  });
});
