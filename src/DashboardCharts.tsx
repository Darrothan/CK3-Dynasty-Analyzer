import { useEffect, useRef, useState } from 'react';
import type { DashboardDrill } from './dashboard';
import type { Row } from './model';

type PlotNode = HTMLDivElement & {
  on: (event: string, handler: (event: { points: { customdata?: unknown }[] }) => void) => void;
  removeAllListeners: (event: string) => void;
};

const palette = ['#d3a66e', '#79a7cf', '#91b88b', '#ce8395', '#b69ad1', '#6bb5aa', '#d2bd78', '#d28c6f', '#9caddb', '#a8bd79'];
export const chartColor = (index: number) => palette[index % palette.length];

const religionPalette: Record<string, string> = {
  christianity_religion: '#d3b777',
  islam_religion: '#4d9b6b',
  judaism_religion: '#648ec9',
  zoroastrianism_religion: '#d27150',
  buddhism_religion: '#d89b4c',
  hinduism_religion: '#df7657',
  paganism_religion: '#898e79',
};
function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
export function religionColor(key: string | null): string {
  if (!key) return '#858b96';
  return religionPalette[key] ?? `hsl(${stableHash(key) % 360}, 45%, 52%)`;
}
export function religionColors(rows: Row[]): string[] {
  return rows.map(row => {
    const level = Number(row.level);
    const root = row.religion_key == null ? null : String(row.religion_key);
    if (level === 1) return religionColor(root);
    if (typeof row.color === 'string' && /^#[\da-f]{6}$/i.test(row.color)) return row.color;
    const key = String((level === 2 ? row.faith_key : row.rite_key) ?? (level === 2 ? row.faith : row.rite) ?? 'unknown');
    const hash = stableHash(`${root ?? 'unknown'}:${key}`);
    return `hsl(${hash % 360}, 38%, ${55 + hash % 15}%)`;
  });
}

export function hierarchyColors(ids: string[], parents: string[]): string[] {
  const children = new Map<string, string[]>();
  ids.forEach((id, i) => { const siblings = children.get(parents[i]) ?? []; siblings.push(id); children.set(parents[i], siblings); });
  for (const siblings of children.values()) siblings.sort();
  const roots = children.get('') ?? [];
  const indexes = new Map(ids.map((id, index) => [id, index]));
  const color = (id: string, depth: number): { hue: number; lightness: number } => {
    const index = indexes.get(id);
    if (index === undefined || depth > 10) return { hue: 0, lightness: 60 };
    const parent = parents[index];
    if (!parent) return { hue: (Math.max(0, roots.indexOf(id)) * 137 + 32) % 360, lightness: 53 };
    const base = color(parent, depth + 1);
    const siblings = children.get(parent) ?? [];
    const sibling = Math.max(0, siblings.indexOf(id));
    return { hue: (base.hue + (sibling - (siblings.length - 1) / 2) * 12 + 3600) % 360, lightness: Math.min(79, base.lightness + 6 + (sibling % 3) * 3) };
  };
  return ids.map(id => { const { hue, lightness } = color(id, 0); return `hsl(${hue}, 48%, ${lightness}%)`; });
}

function Plot({ traces, layout, label, onDrill }: { traces: object[]; layout: object; label: string; onDrill?: (drill: DashboardDrill) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const handler = useRef(onDrill);
  handler.current = onDrill;
  const [error, setError] = useState('');
  const chartData = JSON.stringify([traces, layout]);
  useEffect(() => {
    const node = ref.current as PlotNode | null;
    if (!node) return;
    let active = true;
    void import('plotly.js-dist-min').then(async ({ default: Plotly }) => {
      if (!active) return;
      await Plotly.react(node, traces, { autosize: true, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { color: '#b5c3d3', family: 'Inter, sans-serif', size: 12 }, ...layout }, { responsive: true, displaylogo: false });
      if (!active) return;
      node.removeAllListeners('plotly_click');
      node.on('plotly_click', event => {
        const item = event.points[0]?.customdata;
        if (item && typeof item === 'object' && 'kind' in item && 'value' in item && 'label' in item) {
          const drill = item as DashboardDrill;
          if (typeof drill.kind === 'string' && (drill.value === null || typeof drill.value === 'string') && typeof drill.label === 'string') handler.current?.(drill);
        }
      });
      setError('');
    }).catch(e => { if (active) setError(`Unable to render ${label}: ${e instanceof Error ? e.message : String(e)}`); });
    return () => { active = false; };
  }, [chartData, label]);
  useEffect(() => {
    const node = ref.current;
    return () => { if (node) void import('plotly.js-dist-min').then(({ default: Plotly }) => Plotly.purge(node)).catch(e => console.error('Unable to release chart:', e)); };
  }, []);
  return <>{error && <p role="alert">{error}</p>}<div ref={ref} aria-label={label} /></>;
}

export function ReligionSunburst({ rows, onDrill }: { rows: Row[]; onDrill: (drill: DashboardDrill) => void }) {
  const id = (parts: Row[string][]) => JSON.stringify(parts);
  const ids = rows.map(r => id([r.religion_id, ...(Number(r.level) >= 2 ? [r.faith_id] : []), ...(Number(r.level) >= 3 ? [r.rite_id] : [])]));
  const parents = rows.map(r => Number(r.level) === 1 ? '' : id([r.religion_id, ...(Number(r.level) === 3 ? [r.faith_id] : [])]));
  const labels = rows.map(r => String(Number(r.level) === 1 ? r.religion : Number(r.level) === 2 ? r.faith : r.rite));
  const customdata = rows.map((r, i) => ({ kind: Number(r.level) === 1 ? 'religion' : Number(r.level) === 2 ? 'faith' : 'rite', value: Number(r.level) === 1 ? r.religion_id : Number(r.level) === 2 ? r.faith_id : r.rite_id, label: labels[i] }));
  return <section className="card"><h2>Religion → faith → rite</h2><p>Religion colors are fixed; faiths and rites use their recorded game colors when available. Click a segment to inspect members.</p>{rows.length ? <Plot label="Religion, faith and rite sunburst" traces={[{ type: 'sunburst', ids, parents, labels, values: rows.map(r => r.n), customdata, marker: { colors: religionColors(rows), line: { color: '#1b2533', width: 1 } }, branchvalues: 'total', hovertemplate: '%{label}: %{value}<extra></extra>' }]} layout={{ height: 440, margin: { t: 10, b: 10, l: 10, r: 10 } }} onDrill={onDrill} /> : <p>No members in this cohort.</p>}</section>;
}

export function CultureSunburst({ rows, mode, onDrill }: { rows: Row[]; mode: 'heritage' | 'language'; onDrill: (drill: DashboardDrill) => void }) {
  const ids = rows.map(r => JSON.stringify(Number(r.level) === 1 ? [r.parent_id] : [r.parent_id, r.culture_id]));
  const parents = rows.map(r => Number(r.level) === 1 ? '' : JSON.stringify([r.parent_id]));
  const labels = rows.map(r => String(Number(r.level) === 1 ? r.parent : r.culture));
  const customdata = rows.map((r, i) => ({ kind: Number(r.level) === 1 ? mode : 'culture', value: Number(r.level) === 1 ? r.parent_id : r.culture_id, label: labels[i] }));
  return <section className="card"><h2>{mode === 'heritage' ? 'Heritage' : 'Language'} → culture</h2><p>Recorded culture pillars; unknown values are not inferred. Click to inspect members.</p>{rows.length ? <Plot label="Culture hierarchy sunburst" traces={[{ type: 'sunburst', ids, parents, labels, values: rows.map(r => r.n), customdata, marker: { colors: hierarchyColors(ids, parents), line: { color: '#1b2533', width: 1 } }, branchvalues: 'total', hovertemplate: '%{label}: %{value}<extra></extra>' }]} layout={{ height: 440, margin: { t: 10, b: 10, l: 10, r: 10 } }} onDrill={onDrill} /> : <p>No members in this cohort.</p>}</section>;
}

export function GroupedBars({ title, description, labels, series, onDrill, stacked = false }: { title: string; description: string; labels: string[]; series: { name: string; values: (number | null)[]; drills?: DashboardDrill[]; detail?: string[] }[]; onDrill?: (drill: DashboardDrill) => void; stacked?: boolean }) {
  const positions = labels.map((_, i) => i);
  const traces = series.map((s, i) => ({ type: 'bar', name: s.name, x: positions, y: s.values, customdata: s.drills, hovertext: labels.map((label, index) => s.detail?.[index] ? `${label}<br>${s.detail[index]}` : label), marker: { color: chartColor(i) }, hovertemplate: '%{hovertext}<br>%{y:.1f}<extra>%{fullData.name}</extra>' }));
  return <section className="card"><h2>{title}</h2><p>{description}</p>{labels.length ? <Plot label={title} traces={traces} layout={{ height: 360, barmode: stacked ? 'stack' : 'group', margin: { t: 15, b: 100, l: 55, r: 20 }, legend: { orientation: 'h' }, xaxis: { tickmode: 'array', tickvals: positions, ticktext: labels } }} onDrill={onDrill} /> : <p>No recorded values in this cohort.</p>}</section>;
}

export function HistoricalPopulation({ rows }: { rows: Row[] }) {
  return <section className="card"><h2>Historical living population</h2><p>Known alive on January 1 of each decade, up to 50 decades. Unknown lifetimes are shown separately; pruned records are absent. Current cohort filters apply throughout.</p>{rows.length ? <Plot label="Historical living population" traces={[
    { type: 'scatter', mode: 'lines+markers', name: 'Known alive', x: rows.map(r => r.year), y: rows.map(r => r.n), line: { color: chartColor(1) } },
    { type: 'scatter', mode: 'lines', name: 'Unknown eligibility', x: rows.map(r => r.year), y: rows.map(r => r.unknown), line: { color: chartColor(3) } },
  ]} layout={{ height: 320, margin: { t: 10, b: 45, l: 55, r: 15 } }} /> : <p>No reconstructable dates in this cohort.</p>}</section>;
}
