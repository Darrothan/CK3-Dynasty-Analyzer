import { useEffect, useMemo, useRef, useState } from 'react';
import type { Connection, Direction, Person, Subgraph } from './genealogy';

type House = { id: string; dynastyId: string; name: string };
let nextRequest = 1000000000;
const color = (id: string | null) => {
  if (!id) return '#718096';
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  return `hsl(${(hash >>> 0) % 360} 55% 48%)`;
};
const name = (person: Person) => `${person.name} · ${person.house ?? 'Unknown house'}`;

export function GenealogyViewer({ worker, dynastyId, houses }: { worker: Worker; dynastyId: string; houses: House[] }) {
  const [query, setQuery] = useState('');
  const [world, setWorld] = useState(false);
  const [matches, setMatches] = useState<Person[]>([]);
  const [focus, setFocus] = useState<Person | null>(null);
  const [target, setTarget] = useState<Person | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction>('both');
  const [depth, setDepth] = useState(3);
  const [rulersOnly, setRulersOnly] = useState(false);
  const [includeSpouses, setIncludeSpouses] = useState(false);
  const [houseId, setHouseId] = useState('');
  const [dynastyFilter, setDynastyFilter] = useState(false);
  const [collapsedAncestors, setCollapsedAncestors] = useState<string[]>([]);
  const [collapsedDescendants, setCollapsedDescendants] = useState<string[]>([]);
  const [graph, setGraph] = useState<Subgraph | null>(null);
  const [path, setPath] = useState<{ connection: Connection; people: Person[] } | null>(null);
  const [marriage, setMarriage] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [transform, setTransform] = useState({ x: 20, y: 20, scale: 1 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const requests = useRef({ search: 0, graph: 0, connection: 0 });

  useEffect(() => {
    const listener = ({ data }: MessageEvent) => {
      if (data.type === 'genealogy-search' && data.requestId === requests.current.search) setMatches(data.people);
      if (data.type === 'genealogy-graph' && data.requestId === requests.current.graph) { setGraph(data.graph); setLoading(false); setError(''); }
      if (data.type === 'genealogy-connection' && data.requestId === requests.current.connection) { setPath({ connection: data.connection, people: data.people }); setError(''); }
      if (data.type === 'error' && Object.values(requests.current).includes(data.requestId)) { setError(data.message); setLoading(false); }
    };
    worker.addEventListener('message', listener);
    return () => worker.removeEventListener('message', listener);
  }, [worker]);
  useEffect(() => {
    const requestId = ++nextRequest;
    requests.current.search = requestId;
    const timer = window.setTimeout(() => worker.postMessage({ type: 'genealogy-search', requestId, search: query, dynasty: world ? '' : dynastyId }), 150);
    return () => window.clearTimeout(timer);
  }, [worker, query, world, dynastyId]);
  useEffect(() => {
    if (!focus) return;
    const requestId = ++nextRequest;
    requests.current.graph = requestId;
    setLoading(true);
    worker.postMessage({ type: 'genealogy-graph', requestId, graph: {
      focus: focus.id, direction, depth, limit: 200, rulersOnly,
      houseId, dynastyId: dynastyFilter ? dynastyId : '', collapsedAncestors, collapsedDescendants, includeSpouses,
    } });
  }, [worker, focus, direction, depth, rulersOnly, houseId, dynastyFilter, dynastyId, collapsedAncestors, collapsedDescendants, includeSpouses]);
  const positions = useMemo(() => {
    const result = new Map<string, { x: number; y: number }>();
    if (!graph) return result;
    const rows = new Map<number, Person[]>();
    for (const person of graph.people) {
      const generation = graph.generations[person.id] ?? 0;
      const row = rows.get(generation) ?? [];
      row.push(person); rows.set(generation, row);
    }
    const width = Math.max(...[...rows.values()].map(row => row.length), 1) * 190;
    const min = Math.min(...rows.keys());
    for (const [generation, people] of rows) {
      people.forEach((person, i) => result.set(person.id, { x: (width - people.length * 190) / 2 + i * 190, y: (generation - min) * 115 }));
    }
    return result;
  }, [graph]);
  const fit = () => {
    const values = [...positions.values()];
    const width = Math.max(180, ...values.map(p => p.x + 180));
    const height = Math.max(65, ...values.map(p => p.y + 65));
    const scale = Math.min(1, 960 / width, 550 / height);
    setTransform({ x: (1000 - width * scale) / 2, y: 25, scale });
  };
  useEffect(() => { if (graph) fit(); }, [graph]); // Refit when a bounded result changes.
  const chooseFocus = (person: Person) => {
    requests.current.connection = 0;
    setFocus(person); setSelected(person.id); setGraph(null); setPath(null);
    setCollapsedAncestors([]); setCollapsedDescendants([]);
  };
  const toggle = (id: string, values: string[], set: (value: string[]) => void) => set(values.includes(id) ? values.filter(value => value !== id) : [...values, id]);
  const selectedPerson = graph?.people.find(person => person.id === selected);
  const peopleById = new Map(graph?.people.map(person => [person.id, person]) ?? []);
  const findPath = () => {
    if (!focus || !target) return;
    const requestId = ++nextRequest;
    requests.current.connection = requestId;
    setPath(null);
    worker.postMessage({ type: 'genealogy-connection', requestId, id: focus.id, target: target.id, includeMarriage: marriage });
  };
  return <section className="card genealogy">
    <h2>Genealogy</h2>
    <p>Explore recorded parent-child links across dynasties. Dashboard cohort filters do not restrict this graph; missing records and ruler evidence remain unknown.</p>
    <div className="controls">
      <label>Find character <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, house or ID" /></label>
      <label className="check"><input type="checkbox" checked={world} onChange={e => setWorld(e.target.checked)} /> Search all dynasties</label>
    </div>
    <div className="genealogy-results" aria-label="Character search results">
      {matches.map(person => <div key={person.id}><span>{name(person)} · #{person.id}</span><button onClick={() => chooseFocus(person)}>Focus</button><button onClick={() => { requests.current.connection = 0; setTarget(person); setPath(null); }}>Set relationship target</button></div>)}
      {!matches.length && <p>No matching retained characters.</p>}
      {matches.length === 50 && <p>Showing the first 50 matches; refine your search.</p>}
    </div>
    {focus && <>
      <div className="controls">
        <label>View <select value={direction} onChange={e => setDirection(e.target.value as Direction)}><option value="both">Ancestors and descendants</option><option value="ancestors">Direct ancestors</option><option value="descendants">Direct descendants</option></select></label>
        <label>Generation depth <select value={depth} onChange={e => setDepth(Number(e.target.value))}>{Array.from({ length: 10 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select></label>
        <label>House filter <select value={houseId} onChange={e => setHouseId(e.target.value)}><option value="">All houses</option>{houses.filter(h => h.dynastyId === dynastyId).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={dynastyFilter} onChange={e => setDynastyFilter(e.target.checked)} /> Selected dynasty and connectors</label>
        <label className="check"><input type="checkbox" checked={rulersOnly} onChange={e => setRulersOnly(e.target.checked)} /> Recorded rulers and connectors</label>
        <label className="check"><input type="checkbox" checked={includeSpouses} onChange={e => setIncludeSpouses(e.target.checked)} /> Show recorded spouses</label>
      </div>
      <p>Focus: <b>{name(focus)}</b>. Filters hide unmatched people but retain connecting lineage; they never delete graph data. Ruler means positive evidence, not proof that others are non-rulers.</p>
      <div className="controls"><button onClick={() => setTransform(t => ({ ...t, scale: Math.min(t.scale * 1.25, 4) }))}>Zoom in</button><button onClick={() => setTransform(t => ({ ...t, scale: Math.max(t.scale / 1.25, 0.02) }))}>Zoom out</button><button onClick={fit}>Fit graph</button><span>Drag to pan; use the mouse wheel to zoom.</span></div>
      {loading && <p role="status">Updating genealogy…</p>}
      {graph?.truncated && <div className="notice">Showing at most 200 characters. Reduce depth, collapse branches, or focus a closer relative to explore the remainder.</div>}
      {graph && <svg className="genealogy-canvas" viewBox="0 0 1000 600" role="group" aria-label="Genealogy graph" onWheel={e => {
        e.preventDefault(); setTransform(t => ({ ...t, scale: Math.max(0.02, Math.min(4, t.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))) }));
      }} onPointerDown={e => {
        if (e.target !== e.currentTarget) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
      }} onPointerMove={e => {
        const origin = drag.current;
        if (!origin) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        const pixelsPerUnit = Math.min(bounds.width / 1000, bounds.height / 600);
        const x = origin.tx + (e.clientX - origin.x) / pixelsPerUnit;
        const y = origin.ty + (e.clientY - origin.y) / pixelsPerUnit;
        setTransform(t => ({ ...t, x, y }));
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          {graph.family.map(edge => {
            const a = positions.get(edge.parent)!, b = positions.get(edge.child)!;
            return <line key={`${edge.parent}:${edge.child}`} x1={a.x + 85} y1={a.y + 32} x2={b.x + 85} y2={b.y + 32} className="genealogy-family"><title>{peopleById.get(edge.parent)?.name}: {edge.role} of {peopleById.get(edge.child)?.name}</title></line>;
          })}
          {graph.marriages.map(edge => {
            const a = positions.get(edge.a)!, b = positions.get(edge.b)!;
            return <line key={`${edge.a}:${edge.b}`} x1={a.x + 85} y1={a.y + 32} x2={b.x + 85} y2={b.y + 32} className="genealogy-marriage" />;
          })}
          {graph.people.map(person => {
            const p = positions.get(person.id)!;
            return <g key={person.id} transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0} aria-label={`Select ${name(person)}`} onClick={() => setSelected(person.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(person.id); } }}>
              <rect width="170" height="65" rx="8" fill={color(person.houseId)} stroke={person.id === selected ? '#fff' : '#1c2638'} strokeWidth={person.id === selected ? 3 : 1} />
              <text x="10" y="23">{person.name.length > 23 ? `${person.name.slice(0, 22)}…` : person.name}</text>
              <text x="10" y="43" className="genealogy-small">{person.status} · {person.ruler === 'Ruler' ? 'Ruler' : 'Ruler unknown'}</text>
              <text x="10" y="57" className="genealogy-small">{(person.house ?? 'Unknown house').slice(0, 25)}</text>
            </g>;
          })}
        </g>
      </svg>}
      <p>Solid lines: recorded parent-child; dashed lines: recorded marriage. Each person appears once, including repeated ancestors. Layout prioritizes bounded generations, not chronological ordering.</p>
      {selectedPerson && <div className="genealogy-detail"><h3>{name(selectedPerson)}</h3><p>#{selectedPerson.id} · {selectedPerson.dynasty ?? 'Unknown dynasty'} · {selectedPerson.status} · {selectedPerson.ruler === 'Ruler' ? 'Recorded ruler' : 'Ruler status unknown'} · Born {selectedPerson.birth ?? 'unknown'} · Died {selectedPerson.death ?? 'unknown'}</p>
        <p>Parents shown: {graph?.family.filter(edge => edge.child === selectedPerson.id).map(edge => `${peopleById.get(edge.parent)?.name ?? 'Unknown'} (${edge.role})`).join(', ') || 'none in this view'}. This view may omit other recorded relatives.</p>
        <div className="controls"><button onClick={() => chooseFocus(selectedPerson)}>Focus this character</button>
          <button onClick={() => toggle(selectedPerson.id, collapsedAncestors, setCollapsedAncestors)}>{collapsedAncestors.includes(selectedPerson.id) ? 'Expand' : 'Collapse'} ancestors</button>
          <button onClick={() => toggle(selectedPerson.id, collapsedDescendants, setCollapsedDescendants)}>{collapsedDescendants.includes(selectedPerson.id) ? 'Expand' : 'Collapse'} descendants</button></div>
      </div>}
      <div className="genealogy-detail"><h3>Relationship path</h3><p>Target: {target ? name(target) : 'Choose a target from the search results.'}</p>
        <label className="check"><input type="checkbox" checked={marriage} onChange={e => { requests.current.connection = 0; setPath(null); setMarriage(e.target.checked); }} /> Include recorded marriages</label>
        <button disabled={!target} onClick={findPath}>Find connection</button>
        {path && (path.connection.ids.length ? <p>{path.people.slice(0, 200).map((person, i) => <span key={person.id}>{i > 0 && ` — ${path.connection.kinds[i - 1] === 'marriage' ? 'marriage' : 'parent-child'} — `}{name(person)}</span>)}{path.people.length > 200 && ` — … (${path.people.length} people on path; showing first 200)`}{path.connection.truncated && ' Search limit reached; a shorter path may exist.'}</p> : <p>{path.connection.truncated ? 'Search limit reached; no path found within 20,000 characters.' : 'No recorded connection found.'}</p>)}
      </div>
    </>}
    {error && <div role="alert" className="alert">{error}</div>}
  </section>;
}
