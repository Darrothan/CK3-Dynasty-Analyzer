import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { Jomini } from 'jomini';
import { extractGamestate } from './import';
import { ageAt, normalize, percentage } from './model';

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
});
