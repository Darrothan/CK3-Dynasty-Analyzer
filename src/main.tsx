import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { numericColumns, percentage, type Row } from './model';
import './style.css';

type TableInfo = Record<string, { count: number; columns: string[] }>;
type Dynasty = { id: string; count: number; living: number; house: string; houseSearch: string };
type ChartItem = { label: string; count: number | null; series: string; isMissing: boolean };
type DirHandle = {
  values(): AsyncIterable<{ kind: string; name: string; getFile?: () => Promise<File> }>;
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' }): Promise<PermissionState>;
};
type DirectoryWindow = Window & { showDirectoryPicker?: (options: { mode: 'read' }) => Promise<DirHandle> };

function containsField(value: unknown, search: string): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => key.toLowerCase().includes(search) || containsField(child, search));
}
function RawTree({ name, value, search }: { name: string; value: unknown; search: string }) {
  if (value === null || typeof value !== 'object') return <div className="raw-leaf"><b>{name}</b>: {value === null ? 'null' : String(value)}</div>;
  const entries = Object.entries(value);
  const shown = search ? entries.filter(([key, child]) => key.toLowerCase().includes(search) || containsField(child, search)) : entries;
  return <details open={search ? true : undefined}><summary>{name} {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</summary><div className="raw-branch">{shown.map(([key, child]) => <RawTree key={key} name={key} value={child} search={search} />)}</div></details>;
}

function Chart({ data, kind, dark }: { data: ChartItem[]; kind: string; dark: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const [chartError, setChartError] = useState('');
  useEffect(() => {
    let active = true;
    const node = element.current;
    if (!node) return;
    setChartError('');
    void import('plotly.js-dist-min').then(({ default: Plotly }) => {
      if (!active) return;
      const groups = [...new Set(data.map(d => d.series))];
      const traces = groups.map(group => {
        const values = data.filter(d => d.series === group);
        const labels = values.map(d => d.label), counts = values.map(d => d.count);
        return kind === 'pie'
          ? { type: 'pie', labels, values: counts, hole: 0.45, textinfo: 'label+percent' }
          : { name: group || 'Value', type: kind === 'line' || kind === 'scatter' ? 'scatter' : 'bar', mode: kind === 'scatter' ? 'markers' : 'lines+markers', orientation: kind === 'horizontal' ? 'h' : 'v', x: kind === 'horizontal' ? counts : kind === 'scatter' || kind === 'line' ? labels.map(Number) : labels, y: kind === 'horizontal' ? labels : counts };
      });
      return Plotly.react(node, traces, {
        autosize: true, height: 360, margin: { t: 15, r: 20, b: 100, l: kind === 'horizontal' ? 140 : 55 },
        barmode: kind === 'stacked' ? 'stack' : 'group',
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', font: { color: dark ? '#d9deea' : '#30394a', family: 'Inter, sans-serif', size: 12 },
      }, { responsive: true, displaylogo: false });
    }).catch(error => { if (active) setChartError(`Unable to render chart: ${error instanceof Error ? error.message : String(error)}`); });
    return () => { active = false; void import('plotly.js-dist-min').then(({ default: Plotly }) => Plotly.purge(node)).catch(error => console.error('Unable to release chart:', error)); };
  }, [data, kind, dark]);
  return <>{chartError && <p role="alert">{chartError}</p>}<div ref={element} aria-label="Chart" /></>;
}

function App() {
  const worker = useRef<Worker | null>(null);
  const queryId = useRef(0);
  const directory = useRef<DirHandle | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [living, setLiving] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tables, setTables] = useState<TableInfo>({});
  const [dynasties, setDynasties] = useState<Dynasty[]>([]);
  const [tab, setTab] = useState('Overview');
  const [dataset, setDataset] = useState('characters');
  const [dimension, setDimension] = useState('status');
  const [kind, setKind] = useState('bar');
  const [aggregation, setAggregation] = useState('count');
  const [measure, setMeasure] = useState('');
  const [group, setGroup] = useState('');
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState('value');
  const [sortColumn, setSortColumn] = useState('');
  const [sortDirection, setSortDirection] = useState('asc');
  const [filters, setFilters] = useState([{ column: '', value: '' }, { column: '', value: '' }]);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<{ column: string; value: string; isMissing: boolean } | null>(null);
  const [saved, setSaved] = useState<{ dataset: string; dimension: string; kind: string; aggregation: string; measure: string; group: string; limit: number; sort: string }[]>([]);
  const [search, setSearch] = useState('');
  const [dynasty, setDynasty] = useState('');
  const [dynastySearch, setDynastySearch] = useState('');
  const [includeDead, setIncludeDead] = useState(true);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [chart, setChart] = useState<ChartItem[]>([]);
  const [path, setPath] = useState('/living/36959');
  const [raw, setRaw] = useState('');
  const [rawSearch, setRawSearch] = useState('');
  const [inspector, setInspector] = useState<{ character: Row; traits: Row[]; relationships: Row[]; titles: Row[] } | null>(null);
  const [dark, setDark] = useState(true);
  const [drag, setDrag] = useState(false);
  const dynastyOptions = useMemo(() => {
    const term = dynastySearch.toLocaleLowerCase();
    const matches = dynasties.filter(d => `${d.id} ${d.houseSearch}`.toLocaleLowerCase().includes(term));
    const shown = matches.slice(0, 200);
    const selected = dynasties.find(d => d.id === dynasty);
    if (selected && !shown.some(d => d.id === dynasty)) shown.unshift(selected);
    return { shown, count: matches.length };
  }, [dynasties, dynasty, dynastySearch]);

  useEffect(() => () => worker.current?.terminate(), []);
  function start(file: File) {
    worker.current?.terminate();
    setTables({}); setRows([]); setChart([]); setDynasties([]); setDate(null); setWarnings([]);
    setError(''); setRaw(''); setInspector(null); setSearch(''); setDynasty(''); setPage(0);
    setDataset('characters'); setDimension('status'); setAggregation('count'); setMeasure(''); setGroup(''); setSaved([]); setStage('Starting import');
    const w = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = ({ data }) => {
      if (data.type === 'stage') setStage(data.stage);
      if (data.type === 'ready') {
        setDate(data.date); setLiving(data.living); setWarnings(data.warnings); setTables(data.tables); setDynasties(data.dynasties);
        setStage(''); setTab('Overview');
      }
      if (data.type === 'result' && data.requestId === queryId.current) { setRows(data.rows); setTotal(data.total); setChart(data.chart); }
      if (data.type === 'character') {
        if (data.character) setInspector(data);
        else setError('The related character is not present in the supported character sections.');
      }
      if (data.type === 'raw') { setRaw(data.output); setStage(''); }
      if (data.type === 'export') {
        const url = URL.createObjectURL(data.blob);
        const a = document.createElement('a'); a.href = url; a.download = `${data.dataset}-filtered.csv`; a.click(); URL.revokeObjectURL(url);
        setStage('');
      }
      if (data.type === 'error' && (data.requestId == null || data.requestId === queryId.current)) { setError(data.message); setStage(''); }
    };
    w.onerror = event => { setError(`Worker failed: ${event.message}. The save may be too large for this browser.`); setStage(''); };
    w.postMessage({ type: 'import', file });
  }
  useEffect(() => {
    if (!tables[dataset]) return;
    const requestId = ++queryId.current;
    const timer = window.setTimeout(() => worker.current?.postMessage({ type: 'query', dataset, dimension, search, dynasty: dataset === 'characters' ? dynasty : '', includeDead, page, aggregation, measure, group: kind === 'pie' ? '' : group, limit, sort, filters, sortColumn, sortDirection, kind, categoryFilter, requestId }), 150);
    return () => window.clearTimeout(timer);
  }, [tables, dataset, dimension, search, dynasty, includeDead, page, aggregation, measure, group, limit, sort, kind, filters, sortColumn, sortDirection, categoryFilter]);

  async function refreshDirectory(handle = directory.current) {
    if (!handle) return;
    try {
      let permission = await handle.queryPermission({ mode: 'read' });
      if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'read' });
      if (permission !== 'granted') throw new Error('Read permission was not granted.');
      const found: File[] = [];
      for await (const entry of handle.values()) {
        if (entry.kind === 'file' && (entry.name.toLowerCase().endsWith('.ck3') || entry.name.toLowerCase() === 'gamestate') && entry.getFile) found.push(await entry.getFile());
      }
      found.sort((a, b) => b.lastModified - a.lastModified); setFiles(found); setError('');
    } catch (e) { setFiles([]); setError(`Directory access failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function chooseDirectory() {
    const picker = (window as DirectoryWindow).showDirectoryPicker;
    if (!picker) { setError('Directory selection is unavailable in this browser. Use the file picker instead.'); return; }
    try { const handle = await picker.call(window, { mode: 'read' }); directory.current = handle; await refreshDirectory(handle); }
    catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return; setError(`Directory access failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  function changeDataset(name: string) {
    setDataset(name); setDimension(tables[name]?.columns[0] ?? ''); setKind('bar'); setAggregation('count'); setMeasure(''); setGroup(''); setPage(0); setSearch(''); setSortColumn(''); setFilters([{ column: '', value: '' }, { column: '', value: '' }]); setCategoryFilter(null); setHiddenColumns([]);
  }
  function openRecord(name: string, id: Row[string]) {
    if (id == null || !tables[name]) return;
    changeDataset(name);
    setCategoryFilter({ column: 'id', value: String(id), isMissing: false });
    setTab('Data tables');
    setInspector(null);
  }
  function exportRows() {
    setStage('Exporting filtered rows');
    worker.current?.postMessage({ type: 'export', dataset, selectedColumns: tables[dataset].columns.filter(c => !hiddenColumns.includes(c)), search, dynasty: dataset === 'characters' ? dynasty : '', includeDead, filters, categoryFilter, sortColumn, sortDirection });
  }
  const ready = Boolean(tables.characters);
  const selectedDynasty = dynasties.find(d => d.id === dynasty);
  let rawValue: unknown;
  if (raw && !raw.includes('\n… truncated;') && raw !== 'No value found at this path.') {
    try { rawValue = JSON.parse(raw); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  return <div className={dark ? 'app dark' : 'app light'}>
    <aside className="sidebar">
      <div className="brand"><div className="mark">✦</div><div><strong>CK3 Analytics</strong><small>LOCAL SAVE EXPLORER</small></div></div>
      <div className="side-label">WORKSPACE</div>
      {['Overview', 'Dynasty explorer', 'Chart builder', 'Data tables', 'Raw explorer'].map(name =>
        <button key={name} className={`nav ${tab === name ? 'active' : ''}`} onClick={() => { setTab(name); if (name === 'Dynasty explorer') { changeDataset('characters'); setDimension('house'); } else if (dimension === '__traits') setDimension('house'); }} disabled={!ready}>{name}</button>)}
      <div className="sidebar-bottom"><span>◉ All data stays on this device</span><button onClick={() => setDark(!dark)}>{dark ? '☼ Light mode' : '☾ Dark mode'}</button></div>
    </aside>
    <main>
      <header><div><div className="eyebrow">YOUR LOCAL ANALYTICS WORKSPACE</div><h1>{ready ? tab : 'Explore your legacy'}</h1><p>{ready ? 'Inspect your save, one story at a time.' : 'Turn your Crusader Kings III save into an explorable dataset.'}</p></div><div className="actions"><button onClick={chooseDirectory}>Local directory</button><label className="button primary">Open save<input type="file" onChange={e => { if (e.target.files?.[0]) start(e.target.files[0]); e.target.value = ''; }} /></label></div></header>
      {error && <div role="alert" className="alert">{error}<button onClick={() => setError('')}>Dismiss</button></div>}
      {stage && <div className="progress"><span className="spinner" /> {stage} <button onClick={() => { worker.current?.terminate(); worker.current = null; setTables({}); setRows([]); setChart([]); setStage(''); setError('Operation cancelled and the in-memory session closed. Select a file to start again.'); }}>Cancel</button></div>}
      {!ready && !stage && <section className={`drop ${drag ? 'drag' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) start(e.dataTransfer.files[0]); }}>
        <div className="drop-icon">⇧</div><h2>Bring your save to life</h2><p>Drop a .ck3 save or extracted plaintext gamestate here.</p>
        <div className="actions"><label className="button primary">Choose a file<input type="file" onChange={e => { if (e.target.files?.[0]) start(e.target.files[0]); e.target.value = ''; }} /></label><button onClick={chooseDirectory}>Choose local directory</button></div>
        <p className="muted">Files are processed locally. No upload, account, or server.</p>
      </section>}
      {files.length > 0 && !stage && <section className="card"><div className="section-head"><h2>Local saves</h2><button onClick={() => void refreshDirectory()}>Refresh</button></div>{files.map((f, i) => <button className="file" key={`${f.name}-${i}`} onClick={() => start(f)}><b>{f.name}</b><span>{(f.size / 1048576).toFixed(1)} MiB · {new Date(f.lastModified).toLocaleString()}</span></button>)}</section>}
      {directory.current && !files.length && !stage && !error && <section className="card">No compatible files in this directory. <button onClick={() => void refreshDirectory()}>Refresh</button></section>}
      {ready && <>
        {warnings.length > 0 && <div className="notice">{warnings.slice(0, 3).join(' ')} {warnings.length > 3 && `(${warnings.length} warnings total)`}</div>}
        {tab === 'Overview' && <><div className="metrics"><div><small>SAVE DATE</small><strong>{date ?? 'Unknown'}</strong></div><div><small>LIVING CHARACTERS</small><strong>{living.toLocaleString()}</strong></div><div><small>DYNASTIES</small><strong>{tables.dynasties.count.toLocaleString()}</strong></div><div><small>HOUSES</small><strong>{tables.houses.count.toLocaleString()}</strong></div></div><section className="card"><div className="section-head"><div><h2>Your save is ready</h2><p>{tables.characters.count.toLocaleString()} parsed characters, including {(tables.characters.count - living).toLocaleString()} deceased. Explore {Object.keys(tables).length} datasets; names may be localization keys.</p></div><button onClick={() => { changeDataset('characters'); setDimension('house'); setTab('Dynasty explorer'); }}>Explore dynasties →</button></div><h3>Dataset coverage</h3><div className="dataset-grid">{Object.entries(tables).map(([name, info]) => <button key={name} onClick={() => { changeDataset(name); setTab('Data tables'); }}><b>{name.replaceAll('_', ' ')}</b><span>{info.count.toLocaleString()} records →</span></button>)}</div></section></>}
        {(tab === 'Dynasty explorer' || tab === 'Chart builder' || tab === 'Data tables') && <>
          <section className="card controls">
            {tab === 'Dynasty explorer' ? <><label>Find dynasty or house <input value={dynastySearch} onChange={e => setDynastySearch(e.target.value)} placeholder="ID or house name" /></label><label>Dynasty <select value={dynasty} onChange={e => { setDynasty(e.target.value); setDataset('characters'); setPage(0); }}><option value="">All dynasties</option>{dynastyOptions.shown.map(d => <option value={d.id} key={d.id}>Dynasty {d.id}{d.house ? ` · house ${d.house}` : ''} ({d.count})</option>)}</select></label><p>{dynastyOptions.count > 200 && `${dynastyOptions.count.toLocaleString()} matches; showing first 200. Refine the search. `}{selectedDynasty ? `${selectedDynasty.count.toLocaleString()} known members: ${selectedDynasty.living.toLocaleString()} living, ${(selectedDynasty.count - selectedDynasty.living).toLocaleString()} deceased, before filters` : 'All parsed characters'} · percentages use the filtered character count.</p></> : <label>Dataset <select value={dataset} onChange={e => changeDataset(e.target.value)}>{Object.keys(tables).map(name => <option key={name}>{name}</option>)}</select></label>}
            {dataset === 'characters' && <label className="check"><input type="checkbox" checked={includeDead} onChange={e => { setIncludeDead(e.target.checked); setPage(0); }} /> Include deceased</label>}
            {tab !== 'Dynasty explorer' && dataset === 'characters' && dynasty && <button onClick={() => { setDynasty(''); setPage(0); }}>Clear dynasty filter: {dynasty} ×</button>}
            {tab !== 'Data tables' && <><label>Category / X <select value={dimension} onChange={e => { setDimension(e.target.value); if (e.target.value === '__traits') { setKind('bar'); setAggregation('count'); setGroup(''); } }}>{tab === 'Dynasty explorer' && <option value="__traits">Trait prevalence (distinct characters)</option>}{tables[dataset]?.columns.filter(c => !['line', 'scatter', 'histogram'].includes(kind) || numericColumns.includes(c)).map(c => <option key={c}>{c}</option>)}</select></label><label>Chart type <select value={kind} onChange={e => { const next = e.target.value; setKind(next); if (['line', 'scatter', 'histogram'].includes(next)) { setDimension(tables[dataset].columns.find(c => numericColumns.includes(c)) ?? ''); setAggregation('count'); setMeasure(next === 'scatter' ? tables[dataset].columns.filter(c => numericColumns.includes(c))[1] ?? '' : ''); setSort('label'); } }}><option value="bar">Bar</option><option value="horizontal">Horizontal bar</option><option value="stacked">Stacked bar</option><option value="pie">Donut</option>{tables[dataset].columns.some(c => numericColumns.includes(c)) && <><option value="line">Line</option><option value="histogram">Histogram</option><option value="scatter">Scatterplot</option></>}</select></label>
              {tab === 'Chart builder' && <><label>Aggregation <select value={aggregation} disabled={kind === 'histogram' || kind === 'scatter'} onChange={e => { const a = e.target.value; setAggregation(a); setMeasure(a === 'distinct' ? tables[dataset].columns[0] : a === 'count' ? '' : tables[dataset].columns.find(c => numericColumns.includes(c)) ?? ''); }}><option value="count">Count rows</option><option value="distinct">Distinct count</option>{tables[dataset].columns.some(c => numericColumns.includes(c)) && <><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Minimum</option><option value="max">Maximum</option></>}</select></label>
              {(aggregation !== 'count' || kind === 'scatter') && <label>{kind === 'scatter' ? 'Y measure' : 'Measure'} <select value={measure} onChange={e => setMeasure(e.target.value)}>{(aggregation === 'distinct' && kind !== 'scatter' ? tables[dataset].columns : tables[dataset].columns.filter(c => numericColumns.includes(c))).map(c => <option key={c}>{c}</option>)}</select></label>}
              <label>Group / color <select value={group} disabled={kind === 'pie'} onChange={e => setGroup(e.target.value)}><option value="">None</option>{tables[dataset].columns.map(c => <option key={c}>{c}</option>)}</select></label><label>Sort <select value={sort} onChange={e => setSort(e.target.value)}><option value="value">Value descending</option><option value="label">Category ascending</option></select></label><label>Result limit <input type="number" min="1" max="100" value={limit} onChange={e => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} /></label>
              <button onClick={() => setSaved([...saved, { dataset, dimension, kind, aggregation, measure, group, limit, sort }])}>Save chart configuration</button>{saved.map((config, index) => <button key={index} onClick={() => { setDataset(config.dataset); setDimension(config.dimension); setKind(config.kind); setAggregation(config.aggregation); setMeasure(config.measure); setGroup(config.group); setLimit(config.limit); setSort(config.sort); setPage(0); }}>Chart {index + 1}: {config.dataset} / {config.dimension}</button>)}</>}
            </>}
            <label>Search <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Search all fields" /></label>
            {categoryFilter && <button onClick={() => { setCategoryFilter(null); setPage(0); }}>Clear category filter: {categoryFilter.column} = {categoryFilter.value} ×</button>}
            {filters.map((filter, index) => <React.Fragment key={index}><label>Filter {index + 1} field <select value={filter.column} onChange={e => { const next = [...filters]; next[index] = { ...filter, column: e.target.value }; setFilters(next); setPage(0); }}><option value="">None</option>{tables[dataset].columns.map(c => <option key={c}>{c}</option>)}</select></label><label>Contains <input value={filter.value} disabled={!filter.column} onChange={e => { const next = [...filters]; next[index] = { ...filter, value: e.target.value }; setFilters(next); setPage(0); }} /></label></React.Fragment>)}
            {tab === 'Data tables' && <><label>Sort column <select value={sortColumn} onChange={e => { setSortColumn(e.target.value); setPage(0); }}><option value="">Unsorted</option>{tables[dataset].columns.map(c => <option key={c}>{c}</option>)}</select></label><label>Direction <select value={sortDirection} onChange={e => { setSortDirection(e.target.value); setPage(0); }}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
              <details><summary>Choose columns</summary><div className="column-options">{tables[dataset].columns.map(c => <label key={c} className="check"><input type="checkbox" checked={!hiddenColumns.includes(c)} onChange={e => setHiddenColumns(e.target.checked ? hiddenColumns.filter(x => x !== c) : [...hiddenColumns, c])} />{c}</label>)}</div></details>
            </>}
          </section>
          {tab !== 'Data tables' && <section className="card"><div className="section-head"><div><h2>{dimension === '__traits' ? 'Trait prevalence' : dimension.replaceAll('_', ' ')}</h2><p>{dimension === '__traits' ? 'Distinct characters per trait; traits overlap' : kind === 'scatter' ? `Individual points, Y = ${measure}` : `${aggregation} by category`} · up to {limit} results · {total.toLocaleString()} filtered rows{aggregation === 'count' && kind !== 'scatter' ? ' (percentage denominator)' : ''}. {kind === 'histogram' ? 'Bins span 5 units, starting at the displayed value.' : kind === 'pie' ? 'Donut slices show proportions of displayed results.' : ''}</p></div></div><Chart data={chart} kind={kind} dark={dark} /><div className="breakdown">{chart.map((item, index) => <button disabled={dimension === '__traits' || ['scatter', 'histogram'].includes(kind)} onClick={() => { setCategoryFilter({ column: dimension, value: item.label, isMissing: item.isMissing }); setPage(0); }} key={`${item.label}-${item.series}-${index}`}>{item.label}{item.series ? ` / ${item.series}` : ''}: <b>{item.count?.toLocaleString() ?? '—'}</b> {aggregation === 'count' && kind !== 'scatter' && item.count !== null && `(${percentage(item.count, total)?.toFixed(1) ?? '—'}%)`}</button>)}</div></section>}
          <section className="card"><div className="section-head"><div><h2>Records</h2><p>{total.toLocaleString()} matching rows · 50 per page</p></div><button onClick={exportRows}>Export filtered CSV</button></div><div className="table-wrap"><table><thead><tr>{tables[dataset]?.columns.filter(c => !hiddenColumns.includes(c)).map(c => <th key={c}>{c.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} onClick={() => { if (dataset === 'characters') worker.current?.postMessage({ type: 'character', id: row.id }); }}>{tables[dataset]?.columns.filter(c => !hiddenColumns.includes(c)).map(c => <td key={c}>{row[c] === null ? <span className="muted">—</span> : String(row[c])}</td>)}</tr>)}</tbody></table></div><div className="pagination"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1}</span><button disabled={(page + 1) * 50 >= total} onClick={() => setPage(page + 1)}>Next</button></div></section>
        </>}
        {tab === 'Raw explorer' && <section className="card"><h2>Explore a source path</h2><p>Enter a Jomini path, for example /living/36959 or /dynasties/dynasty_house/1338. Large results are truncated after conversion; use a more specific path.</p><div className="actions"><input className="wide" value={path} onChange={e => setPath(e.target.value)} /><button onClick={() => { setStage('Reading source path'); worker.current?.postMessage({ type: 'raw', path }); }}>Inspect</button></div>{rawValue !== undefined && <><label>Search field names in this result <input value={rawSearch} onChange={e => setRawSearch(e.target.value.toLowerCase())} /></label><div className="raw-tree"><RawTree name={path} value={rawValue} search={rawSearch} /></div></>}<details><summary>JSON text / truncated output</summary><pre>{raw || 'No source path inspected yet.'}</pre></details></section>}
      </>}
      <footer>CK3 Save Analytics · Local-first · Not affiliated with Paradox Interactive</footer>
    </main>
    {inspector && <div className="overlay" onClick={() => setInspector(null)}><aside className="inspector" onClick={e => e.stopPropagation()}><div className="section-head"><h2>{inspector.character.name ?? 'Unknown character'}</h2><button onClick={() => setInspector(null)}>Close</button></div><dl>{Object.entries(inspector.character).map(([key, value]) => <React.Fragment key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{value == null ? '—' : String(value)}</dd></React.Fragment>)}</dl><div>{inspector.character.house_id != null && <button onClick={() => openRecord('houses', inspector.character.house_id)}>Open house</button>}{inspector.character.dynasty_id != null && <button onClick={() => openRecord('dynasties', inspector.character.dynasty_id)}>Open dynasty</button>}</div><h3>Traits</h3><p>{inspector.traits.map(t => t.trait).join(', ') || 'None recorded'}</p><h3>Titles held</h3>{inspector.titles.length ? inspector.titles.map(t => <button key={String(t.id)} onClick={() => openRecord('titles', t.id)}>{t.key ?? t.id}</button>) : <p>None recorded</p>}<h3>Relationships</h3>{inspector.relationships.map((r, i) => <button key={i} onClick={() => worker.current?.postMessage({ type: 'character', id: r.relative_id })}>{r.relation}: {r.relative_id}{r.derived === 'yes' ? ' (derived)' : ''}</button>)}</aside></div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
