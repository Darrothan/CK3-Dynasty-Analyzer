import type { Row } from './model';
import { normalizeSearch } from './localization';

export type Person = {
  id: string; name: string; houseId: string | null; house: string | null;
  dynastyId: string | null; dynasty: string | null; status: string;
  ruler: string; birth: string | null; death: string | null;
};
export type FamilyEdge = { parent: string; child: string; role: 'father' | 'mother' | 'parent' };
export type MarriageEdge = { a: string; b: string };
export type Direction = 'ancestors' | 'descendants' | 'both';
export type GraphRequest = {
  focus: string; direction: Direction; depth: number; limit: number;
  collapsedAncestors?: string[]; collapsedDescendants?: string[];
  rulersOnly?: boolean; houseId?: string; dynastyId?: string; includeSpouses?: boolean;
};
export type Subgraph = {
  people: Person[]; family: FamilyEdge[]; marriages: MarriageEdge[];
  generations: Record<string, number>; truncated: boolean;
};
export type Connection = { ids: string[]; kinds: ('family' | 'marriage')[]; truncated: boolean };

const str = (v: Row[string]) => v == null ? null : String(v);
const pair = (a: string, b: string) => JSON.stringify([a, b]);
const add = (map: Map<string, Set<string>>, key: string, value: string) => {
  let values = map.get(key);
  if (!values) { values = new Set(); map.set(key, values); }
  values.add(value);
};

/** A canonical graph over retained records; absent targets are not invented. */
export class GenealogyGraph {
  readonly people = new Map<string, Person>();
  private parents = new Map<string, Set<string>>();
  private children = new Map<string, Set<string>>();
  private spouses = new Map<string, Set<string>>();
  private family = new Map<string, FamilyEdge>();
  private roles = new Map<string, Set<'father' | 'mother'>>();
  private marriages = new Map<string, MarriageEdge>();
  private searchIndex: { person: Person; key: string }[] = [];

  constructor(characters: Row[], relationships: Row[]) {
    for (const row of characters) {
      const id = str(row.id);
      if (!id) throw new Error('A genealogy character is missing its ID.');
      if (this.people.has(id)) throw new Error(`Duplicate genealogy character ID: ${id}`);
      const person: Person = {
        id, name: str(row.name) || 'Unnamed character', houseId: str(row.house_id), house: str(row.house),
        dynastyId: str(row.dynasty_id), dynasty: str(row.dynasty), status: str(row.status) || 'Unknown',
        ruler: str(row.ruler_status) || 'Unknown', birth: str(row.birth), death: str(row.death),
      };
      this.people.set(id, person);
      this.searchIndex.push({ person, key: normalizeSearch(`${person.name} ${person.house ?? ''} ${person.dynasty ?? ''} ${id}`) });
    }
    for (const row of relationships) {
      const id = str(row.character_id), relative = str(row.relative_id), relation = str(row.relation);
      if (!id || !relative || id === relative || !this.people.has(id) || !this.people.has(relative)) continue;
      if (relation === 'spouse') {
        const [a, b] = id < relative ? [id, relative] : [relative, id];
        this.marriages.set(pair(a, b), { a, b });
        add(this.spouses, a, b); add(this.spouses, b, a);
      } else if (relation === 'father' || relation === 'mother' || relation === 'parent' || relation === 'child') {
        const parent = relation === 'child' ? id : relative, child = relation === 'child' ? relative : id;
        const key = pair(parent, child);
        const role = relation === 'father' || relation === 'mother' ? relation : 'parent';
        if (role !== 'parent') {
          const roles = this.roles.get(key) ?? new Set<'father' | 'mother'>();
          roles.add(role); this.roles.set(key, roles);
        }
        const roles = this.roles.get(key);
        const merged = roles?.size === 1 ? [...roles][0] : 'parent';
        this.family.set(key, { parent, child, role: merged });
        add(this.parents, child, parent); add(this.children, parent, child);
      }
    }
  }

  getParents(id: string): string[] { return [...(this.parents.get(id) ?? [])]; }
  getChildren(id: string): string[] { return [...(this.children.get(id) ?? [])]; }
  getSpouses(id: string): string[] { return [...(this.spouses.get(id) ?? [])]; }

  search(term: string, dynastyId = '', limit = 50): Person[] {
    const key = normalizeSearch(term.trim()), matches: Person[] = [];
    for (const entry of this.searchIndex) {
      if ((!dynastyId || entry.person.dynastyId === dynastyId) && entry.key.includes(key)) {
        matches.push(entry.person);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  traverse(id: string, direction: 'ancestors' | 'descendants', depth: number, limit = 10000): { ids: string[]; truncated: boolean } {
    const result = this.subgraph({ focus: id, direction, depth, limit });
    return { ids: result.people.map(person => person.id), truncated: result.truncated };
  }

  subgraph(request: GraphRequest): Subgraph {
    const { focus, direction, depth, limit } = request;
    if (!this.people.has(focus)) throw new Error('Focus character is not present in the genealogy.');
    if (!Number.isInteger(depth) || depth < 0 || depth > 30 || !Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid genealogy depth or node limit.');
    if (!['ancestors', 'descendants', 'both'].includes(direction)) throw new Error('Invalid genealogy direction.');
    const selected = new Set([focus]), generations: Record<string, number> = Object.create(null);
    generations[focus] = 0;
    let truncated = false;
    // Keep directional visit sets separate so a repeated ancestor cannot suppress a descendant traversal.
    for (const mode of direction === 'both' ? ['ancestors', 'descendants'] as const : [direction]) {
      const adjacency = mode === 'ancestors' ? this.parents : this.children;
      const collapsed = new Set(mode === 'ancestors' ? request.collapsedAncestors : request.collapsedDescendants);
      const seen = new Set([focus]), queue: [string, number][] = [[focus, 0]];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const [id, level] = queue[cursor];
        if (level >= depth || collapsed.has(id)) continue;
        for (const next of adjacency.get(id) ?? []) {
          if (seen.has(next)) continue;
          if (!selected.has(next) && selected.size >= limit) { truncated = true; continue; }
          seen.add(next); selected.add(next);
          if (generations[next] === undefined) generations[next] = mode === 'ancestors' ? -(level + 1) : level + 1;
          queue.push([next, level + 1]);
        }
      }
    }
    // Retain every node on a directed route from the focus to a matching node.
    if (request.rulersOnly || request.houseId || request.dynastyId) {
      const matching = new Set([...selected].filter(id => {
        const person = this.people.get(id)!;
        return (!request.rulersOnly || person.ruler === 'Ruler') &&
          (!request.houseId || person.houseId === request.houseId) &&
          (!request.dynastyId || person.dynastyId === request.dynastyId);
      }));
      const keep = new Set([focus]);
      for (const mode of direction === 'both' ? ['ancestors', 'descendants'] as const : [direction]) {
        const forward = mode === 'ancestors' ? this.parents : this.children;
        const reverse = mode === 'ancestors' ? this.children : this.parents;
        const collapsed = new Set(mode === 'ancestors' ? request.collapsedAncestors : request.collapsedDescendants);
        const reachable = new Set([focus]), queue = [focus];
        for (let i = 0; i < queue.length; i++) {
          if (collapsed.has(queue[i])) continue;
          for (const next of forward.get(queue[i]) ?? []) if (selected.has(next) && !reachable.has(next)) { reachable.add(next); queue.push(next); }
        }
        const back = [...matching].filter(id => reachable.has(id));
        const visited = new Set(back);
        for (let i = 0; i < back.length; i++) {
          const id = back[i]; keep.add(id);
          for (const prev of reverse.get(id) ?? []) if (reachable.has(prev) && !collapsed.has(prev) && !visited.has(prev)) { visited.add(prev); back.push(prev); }
        }
      }
      for (const id of selected) if (!keep.has(id)) selected.delete(id);
    }
    if (request.includeSpouses) {
      for (const id of [...selected]) {
        for (const spouse of this.spouses.get(id) ?? []) {
          if (selected.has(spouse)) continue;
          if (selected.size >= limit) { truncated = true; continue; }
          selected.add(spouse); generations[spouse] = generations[id];
        }
      }
    }
    return this.materialize(selected, generations, truncated);
  }

  private materialize(selected: Set<string>, generations: Record<string, number>, truncated: boolean): Subgraph {
    const family: FamilyEdge[] = [], marriages: MarriageEdge[] = [];
    for (const id of selected) {
      for (const child of this.children.get(id) ?? []) if (selected.has(child)) family.push(this.family.get(pair(id, child))!);
      for (const spouse of this.spouses.get(id) ?? []) if (selected.has(spouse) && id < spouse) marriages.push(this.marriages.get(pair(id, spouse))!);
    }
    return { people: [...selected].map(id => this.people.get(id)!), family, marriages, generations, truncated };
  }

  connection(start: string, end: string, includeMarriage = false, limit = 10000): Connection {
    if (!this.people.has(start) || !this.people.has(end)) throw new Error('Both characters must be present in the genealogy.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100000) throw new Error('Invalid relationship search limit.');
    const queue = [start], previous = new Map<string, { id: string; kind: 'family' | 'marriage' } | null>([[start, null]]);
    let truncated = false;
    for (let i = 0; i < queue.length && !previous.has(end); i++) {
      const id = queue[i];
      for (const [neighbors, kind] of [[this.parents.get(id), 'family'], [this.children.get(id), 'family'], [includeMarriage ? this.spouses.get(id) : undefined, 'marriage']] as const) {
        for (const next of neighbors ?? []) {
          if (previous.has(next)) continue;
          if (previous.size >= limit) { truncated = true; continue; }
          previous.set(next, { id, kind }); queue.push(next);
        }
      }
    }
    if (!previous.has(end)) return { ids: [], kinds: [], truncated };
    const ids = [end], kinds: Connection['kinds'] = [];
    while (ids[ids.length - 1] !== start) {
      const step = previous.get(ids[ids.length - 1])!;
      kinds.push(step.kind); ids.push(step.id);
    }
    return { ids: ids.reverse(), kinds: kinds.reverse(), truncated };
  }
}
