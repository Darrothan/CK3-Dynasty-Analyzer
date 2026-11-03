import { describe, expect, it } from 'vitest';
import { GenealogyGraph } from './genealogy';
import type { Row } from './model';

const person = (id: string, dynasty = 'd1', ruler = 'Unknown'): Row => ({
  id, name: `Person ${id}`, dynasty_id: dynasty, house_id: `h${dynasty}`, status: 'Living', ruler_status: ruler,
});
const link = (character_id: string, relation: string, relative_id: string): Row => ({ character_id, relation, relative_id });

describe('canonical genealogy', () => {
  const graph = new GenealogyGraph(
    [person('1', 'd1', 'Ruler'), person('2'), person('3', 'd2'), person('4', 'd2', 'Ruler'), person('5'), person('6')],
    [link('2', 'father', '1'), link('3', 'mother', '1'), link('4', 'father', '2'),
      link('4', 'mother', '3'), link('2', 'spouse', '3'), link('3', 'spouse', '2'),
      link('1', 'child', '2'), link('5', 'father', 'missing'), link('6', 'father', '2')],
  );
  it('indexes parents, children and spouses without duplicating recorded links', () => {
    expect(graph.getParents('4')).toEqual(['2', '3']);
    expect(graph.getChildren('1')).toEqual(['2', '3']);
    expect(graph.getSpouses('2')).toEqual(['3']);
    expect(graph.getParents('5')).toEqual([]);
    const sub = graph.subgraph({ focus: '4', direction: 'ancestors', depth: 3, limit: 20 });
    expect(sub.people.map(p => p.id)).toEqual(['4', '2', '3', '1']);
    expect(sub.family).toHaveLength(4);
    expect(sub.marriages).toHaveLength(1);
    expect(sub.family.find(e => e.parent === '1' && e.child === '2')?.role).toBe('father');
  });
  it('traverses cross-dynasty ancestors and descendants with unique identities', () => {
    expect(graph.traverse('1', 'descendants', 4).ids).toEqual(['1', '2', '3', '4', '6']);
    expect(graph.traverse('4', 'ancestors', 1).ids).toEqual(['4', '2', '3']);
    expect(graph.search('Person 3', 'd2').map(p => p.id)).toEqual(['3']);
    expect(graph.search('Person 3', 'd1')).toEqual([]);
  });
  it('preserves both connecting lines to rulers while pruning collateral branches', () => {
    const sub = graph.subgraph({ focus: '1', direction: 'descendants', depth: 3, limit: 20, rulersOnly: true });
    expect(sub.people.map(p => p.id)).toEqual(['1', '2', '3', '4']);
    expect(sub.family).toHaveLength(4);
    const filtered = graph.subgraph({ focus: '1', direction: 'descendants', depth: 3, limit: 20, dynastyId: 'd2' });
    expect(filtered.people.map(p => p.id)).toEqual(['1', '2', '3', '4']);
  });
  it('collapses branches without deleting the underlying graph', () => {
    const sub = graph.subgraph({ focus: '1', direction: 'descendants', depth: 3, limit: 20, collapsedDescendants: ['2'] });
    expect(sub.people.map(p => p.id)).toEqual(['1', '2', '3', '4']);
    expect(graph.getChildren('2')).toEqual(['4', '6']);
  });
  it('finds shortest paths and distinguishes marriage from biological edges', () => {
    expect(graph.connection('2', '3', true)).toEqual({ ids: ['2', '3'], kinds: ['marriage'], truncated: false });
    expect(graph.connection('2', '3').kinds).toEqual(['family', 'family']);
    expect(graph.connection('1', '5').ids).toEqual([]);
    expect(graph.connection('1', '4', false, 1).truncated).toBe(true);
  });
  it('optionally adds spouses without extending their lineage or exceeding the bound', () => {
    const married = new GenealogyGraph([person('a'), person('b', 'd2'), person('c')], [
      link('a', 'spouse', 'b'), link('b', 'child', 'c'),
    ]);
    const shown = married.subgraph({ focus: 'a', direction: 'descendants', depth: 3, limit: 3, includeSpouses: true });
    expect(shown.people.map(p => p.id)).toEqual(['a', 'b']);
    expect(shown.marriages).toEqual([{ a: 'a', b: 'b' }]);
    expect(married.subgraph({ focus: 'a', direction: 'both', depth: 3, limit: 1, includeSpouses: true }).truncated).toBe(true);
  });
  it('handles malformed cycles and conflicting parent roles', () => {
    const cycle = new GenealogyGraph([person('a'), person('b'), person('c')], [
      link('a', 'father', 'b'), link('a', 'mother', 'b'), link('a', 'father', 'b'),
      link('b', 'father', 'a'), link('c', 'child', 'c'),
    ]);
    const result = cycle.subgraph({ focus: 'a', direction: 'both', depth: 10, limit: 10 });
    expect(result.people).toHaveLength(2);
    expect(result.family.find(e => e.parent === 'b')?.role).toBe('parent');
    expect(() => new GenealogyGraph([person('a'), person('a')], [])).toThrow(/Duplicate/);
  });
  it('bounds large families and traverses a large chain efficiently', () => {
    const n = 30000;
    const people = Array.from({ length: n }, (_, i) => person(String(i)));
    const family = people.slice(1).map((_, i) => link(String(i), 'child', String(i + 1)));
    const start = performance.now();
    const large = new GenealogyGraph(people, family);
    expect(large.traverse('0', 'descendants', 30).ids).toHaveLength(31);
    expect(large.connection('0', '29999', false, 100000).ids).toHaveLength(n);
    expect(performance.now() - start).toBeLessThan(10000);
    const wide = new GenealogyGraph(people.slice(0, 5000), people.slice(1, 5000).map(p => link('0', 'child', String(p.id))));
    const sub = wide.subgraph({ focus: '0', direction: 'descendants', depth: 2, limit: 100 });
    expect(sub.people).toHaveLength(100);
    expect(sub.truncated).toBe(true);
  });
});
