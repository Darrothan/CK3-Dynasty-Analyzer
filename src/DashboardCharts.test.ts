import { describe, expect, it } from 'vitest';
import { hierarchyColors, religionColor, religionColors } from './DashboardCharts';

describe('hierarchy chart colors', () => {
  it('distinguishes roots and siblings while keeping descendant hues near their parent', () => {
    const ids = ['religion-a', 'religion-b', 'faith-a', 'faith-b', 'rite-a', 'rite-b'];
    const colors = hierarchyColors(ids, ['', '', 'religion-a', 'religion-a', 'faith-a', 'faith-a']);
    expect(new Set(colors).size).toBe(colors.length);
    const hue = (index: number) => Number(colors[index].match(/hsl\(([\d.]+)/)?.[1]);
    const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    expect(distance(hue(0), hue(2))).toBeLessThan(30);
    expect(distance(hue(2), hue(4))).toBeLessThan(30);
    expect(distance(hue(0), hue(1))).toBeGreaterThan(60);
  });
  it('uses stable religion keys and recorded faith and rite colors across cohorts', () => {
    const root = { level: 1, religion_id: '4', religion_key: 'christianity_religion' };
    const faith = { level: 2, religion_id: '4', religion_key: 'christianity_religion', faith_key: 'catholic', color: '#cccc99' };
    const rite = { level: 3, religion_id: '4', religion_key: 'christianity_religion', rite_key: 'roman_rite', color: '#123456' };
    expect(religionColors([root, faith, rite])).toEqual([religionColor('christianity_religion'), '#cccc99', '#123456']);
    expect(religionColors([{ ...root, religion_id: '90' }])[0]).toBe(religionColors([root])[0]);
    expect(religionColor('zoroastrianism_religion')).not.toBe(religionColor('christianity_religion'));
    expect(religionColors([{ ...faith, color: null }])[0]).toBe(religionColors([{ ...faith, color: null, religion_id: '90' }])[0]);
  });
});
