import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { historicalPredicate, type CohortFilters, type CohortSex, type CohortStatus, type HistoricalFilter, type RulerFilter } from './analytics';
import type { DashboardDrill, DashboardSection, DrillKind } from './dashboard';
import { normalizeSearch } from './localization';
import { skillNames, type Row } from './model';
import { chartColor, CultureSunburst, GroupedBars, HistoricalPopulation, ReligionSunburst } from './DashboardCharts';

type Dynasty = { id: string; name: string; count: number; house: string; houseSearch: string };
type House = { id: string; dynastyId: string; name: string };
type Results = Record<string, Row[]>;
const sections: DashboardSection[] = ['overview', 'demographics', 'culture', 'traits', 'skills', 'houses'];
let nextDashboardRequestId = 0;
const initial = (dynastyId: string): CohortFilters => ({ dynastyId, houseId: '', status: 'Both', sex: 'All', ruler: 'All', historical: null, minAge: null, maxAge: null });
const display = (value: Row[string]) => value == null ? '—' : typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : String(value);

function Breakdown({ title, rows, kind, onDrill }: { title: string; rows: Row[]; kind: DrillKind; onDrill: (drill: DashboardDrill) => void }) {
  const maximum = Math.max(1, ...rows.map(row => Number(row.n)));
  return <section className="card dashboard-chart"><h2>{title}</h2>{!rows.length ? <p>No recorded values in this cohort.</p> : <div className="bar-list">{rows.map((row, i) =>
    <button key={`${row.id}-${i}`} onClick={() => onDrill({ kind, value: row.id == null ? null : String(row.id), label: String(row.label) })}>
      <span>{display(row.label)}</span><span className="bar-track"><span style={{ width: `${Number(row.n) / maximum * 100}%`, background: chartColor(i) }} /></span><b>{display(row.n)}</b>
    </button>)}</div>}</section>;
}

export function DynastyDashboard({ worker, dynasties, houses, onCharacter, onTitle }: { worker: Worker; dynasties: Dynasty[]; houses: House[]; onCharacter: (id: string) => void; onTitle: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<CohortFilters>(() => initial(''));
  const [section, setSection] = useState<DashboardSection>('overview');
  const [mode, setMode] = useState<HistoricalFilter['mode']>('alive_on');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [drill, setDrill] = useState<DashboardDrill | null>(null);
  const [page, setPage] = useState(0);
  const [skill, setSkill] = useState<string>('diplomacy');
  const [cultureMode, setCultureMode] = useState<'heritage' | 'language'>('heritage');
  const [results, setResults] = useState<Results | null>(null);
  const [resultSection, setResultSection] = useState<DashboardSection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const requestSection = useRef<DashboardSection>(section);
  const options = useMemo(() => {
    const term = normalizeSearch(search);
    const matches = dynasties.filter(d => normalizeSearch(`${d.name} ${d.houseSearch} ${d.id}`).includes(term));
    const shown = matches.slice(0, 200);
    const selected = dynasties.find(d => d.id === filters.dynastyId);
    if (selected && !shown.some(d => d.id === selected.id)) shown.unshift(selected);
    return { shown, count: matches.length };
  }, [dynasties, search, filters.dynastyId]);
  useEffect(() => {
    const listener = ({ data }: MessageEvent) => {
      if (data.requestId !== requestId.current) return;
      if (data.type === 'dashboard') { setResults(data.results); setResultSection(requestSection.current); setLoading(false); setError(''); }
      if (data.type === 'error') { setLoading(false); setError(data.message); }
    };
    worker.addEventListener('message', listener);
    return () => worker.removeEventListener('message', listener);
  }, [worker]);
  useEffect(() => {
    requestId.current = --nextDashboardRequestId;
    if (!filters.dynastyId) { setResults(null); setLoading(false); return; }
    requestSection.current = section;
    setLoading(true);
    const timer = window.setTimeout(() => worker.postMessage({ type: 'dashboard', requestId: requestId.current, dashboard: { filters, section, drill, page } }), 150);
    return () => window.clearTimeout(timer);
  }, [worker, filters, section, drill, page]);
  const change = (patch: Partial<CohortFilters>) => { setFilters(current => ({ ...current, ...patch })); setDrill(null); };
  const row = results?.summary?.[0];
  const active = results?.cohorts?.find(r => r.cohort === 'selected');
  const setCategory = useCallback((next: DashboardDrill) => { setPage(0); setDrill(next); }, []);
  const chart = (key: string, title: string, kind: DrillKind) => <Breakdown title={title} rows={results?.[key] ?? []} kind={kind} onDrill={setCategory} />;
  const skillRows = results?.skills ?? [];
  const skillHouseRows = (results?.skill_houses ?? []).filter(r => r.skill === skill && Number(r.n) > 0).sort((a, b) => Number(b.n) - Number(a.n)).slice(0, 15);
  const houseRows = (results?.houses ?? []).slice(0, 15);
  const houseDrills = houseRows.map(r => ({ kind: 'house' as const, value: r.id == null ? null : String(r.id), label: String(r.label) }));
  const table = (key: string, columns: string[], title: string) => <section className="card"><h2>{title}</h2><div className="table-wrap"><table><thead><tr>{columns.map(c => <th key={c}>{c.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{(results?.[key] ?? []).map((r, i) => <tr key={i}>{columns.map(c => <td key={c}>{key === 'leaders' && c === 'name' ? <button onClick={() => onCharacter(String(r.id))}>{display(r[c])}</button> : key === 'houses' && c === 'label' ? <button onClick={() => setCategory({ kind: 'house', value: r.id == null ? null : String(r.id), label: String(r.label) })}>{display(r[c])}</button> : key === 'titles' && c === 'title' ? <button onClick={() => onTitle(String(r.id))}>{display(r[c])}</button> : (key === 'culture_house' || key === 'faith_house') && c === 'label' ? <button onClick={() => setCategory({ kind: key === 'culture_house' ? 'culture' : 'faith', value: r.id == null ? null : String(r.id), houseId: r.house_id == null ? null : String(r.house_id), label: `${r.label} · ${r.house}` })}>{display(r[c])}</button> : display(r[c])}</td>)}</tr>)}</tbody></table></div>{!results?.[key]?.length && <p>No recorded values in this cohort.</p>}</section>;
  return <>
    <section className="card">
      <div className="controls">
        <label>Find dynasty or house <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search names" /></label>
        <label>Dynasty <select value={filters.dynastyId} onChange={e => { setFilters(initial(e.target.value)); setDrill(null); }}><option value="">Select a dynasty</option>{options.shown.map(d => <option key={d.id} value={d.id}>{d.name || (d.house ? `House ${d.house} (dynasty name unresolved)` : `Unresolved dynasty #${d.id}`)} ({d.count})</option>)}</select></label>
        {options.count > 200 && <p>{options.count.toLocaleString()} matches; showing the first 200.</p>}
      </div>
      {filters.dynastyId && <><div className="controls dashboard-filters">
        <label>House <select value={filters.houseId} onChange={e => change({ houseId: e.target.value })}><option value="">All houses</option>{houses.filter(h => h.dynastyId === filters.dynastyId).map(h => <option value={h.id} key={h.id}>{h.name}</option>)}</select></label>
        <label>Status <select value={filters.status} onChange={e => change({ status: e.target.value as CohortStatus })}><option>Both</option><option>Living</option><option>Deceased</option></select></label>
        <label>Ruler evidence <select value={filters.ruler} onChange={e => change({ ruler: e.target.value as RulerFilter })}><option>All</option><option>Ruler</option><option>Unknown</option></select></label>
        <label>Sex <select value={filters.sex} onChange={e => change({ sex: e.target.value as CohortSex })}><option>All</option><option>Female</option><option>Male</option><option>Unknown</option></select></label>
        <label>Minimum age <input type="number" min="0" max="1000" value={filters.minAge ?? ''} onChange={e => change({ minAge: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <label>Maximum age <input type="number" min="0" max="1000" value={filters.maxAge ?? ''} onChange={e => change({ maxAge: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <button onClick={() => { setFilters(initial(filters.dynastyId)); setDrill(null); setStart(''); setEnd(''); setError(''); }}>Reset filters</button>
      </div><div className="controls dashboard-filters">
        <label>Historical inclusion <select value={mode} onChange={e => setMode(e.target.value as HistoricalFilter['mode'])}><option value="alive_on">Alive on date</option><option value="alive_during">Alive during range</option><option value="born_during">Born during range</option><option value="died_during">Died during range</option></select></label>
        <label>{mode === 'alive_on' ? 'Date' : 'Start date'} <input value={start} onChange={e => setStart(e.target.value)} placeholder="867.1.1" /></label>
        {mode !== 'alive_on' && <label>End date <input value={end} onChange={e => setEnd(e.target.value)} placeholder="867.12.31" /></label>}
        <button onClick={() => { const historical: HistoricalFilter = mode === 'alive_on' ? { mode, date: start } : { mode, start, end }; try { historicalPredicate(historical); change({ historical }); setError(''); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>Apply date</button>
        {filters.historical && <button onClick={() => change({ historical: null })}>Clear date ×</button>}
      </div><p>{filters.historical ? `Active date: ${filters.historical.mode.replaceAll('_', ' ')} ${filters.historical.mode === 'alive_on' ? filters.historical.date : `${filters.historical.start}–${filters.historical.end}`}. ` : ''}Age is at the save date for living characters and at death for deceased characters; age filters exclude missing ages. Ruler means positive current evidence; all others are unknown. Historical eligibility uses inclusive dates and excludes unknown lifetimes.</p></>}
    </section>
    {error && <div role="alert" className="alert">{error}</div>}
    {!filters.dynastyId ? <section className="card"><h2>Choose a dynasty</h2><p>Search by dynasty or house name to explore its retained members.</p></section> : <>
      <div className="dashboard-tabs">{sections.map(s => <button key={s} className={section === s ? 'active' : ''} onClick={() => { setSection(s); setDrill(null); }}>{s === 'culture' ? 'Culture & faith' : s}</button>)}</div>
      <div className="dashboard-update" role="status">{loading ? 'Updating dashboard…' : '\u00a0'}</div>
      {!results && !error && <p>Calculating dashboard…</p>}
      {results && resultSection === section && <div className={loading || error ? 'dashboard-pending' : ''} aria-busy={loading}><p className="cohort-note"><b>{display(active?.population ?? 0)} characters</b> in the active cohort{filters.historical ? `; ${display(active?.historical_unknown ?? 0)} with unknown historical eligibility excluded` : ''}. These are retained save records, not a complete historical population.</p>
        {section === 'overview' && <><div className="metrics dashboard-metrics">{[['Population', row?.population], ['Living', row?.living], ['Deceased', row?.deceased], ['Houses', row?.houses], ['Recorded rulers', row?.rulers], ['Ruler unknown', row?.ruler_unknown]].map(([label, value]) => <div key={String(label)}><small>{label}</small><strong>{display(value ?? null)}</strong></div>)}</div>{chart('houses', 'Members by house', 'house')}</>}
        {section === 'demographics' && <><p>Birth dates unavailable or unreliable: {display(results.date_quality?.[0]?.missing_birth)}; deceased members with unavailable or unreliable death dates: {display(results.date_quality?.[0]?.missing_death)}. These dates are excluded from decade charts.</p><div className="dashboard-grid">{chart('age', 'Age distribution', 'age')}{chart('sex', 'Sex distribution', 'sex')}{chart('birth', 'Recorded births by decade', 'birth')}{chart('death', 'Recorded deaths by decade', 'death')}</div><HistoricalPopulation rows={results.history ?? []} /><section className="card"><h2>Recorded lifespan</h2><p>Deceased characters with valid ages: {display(results.lifespan?.[0]?.known)} · Mean {display(results.lifespan?.[0]?.mean)} · Median {display(results.lifespan?.[0]?.median)} years. Missing or inconsistent dates are excluded.</p></section></>}
        {section === 'culture' && <><div className="dashboard-grid"><ReligionSunburst rows={results.hierarchy ?? []} onDrill={setCategory} /><div><div className="controls culture-mode"><label>Culture grouping <select value={cultureMode} onChange={e => setCultureMode(e.target.value === 'language' ? 'language' : 'heritage')}><option value="heritage">Heritage</option><option value="language">Language</option></select></label></div><CultureSunburst rows={results[`${cultureMode}_hierarchy`] ?? []} mode={cultureMode} onDrill={setCategory} /></div></div><div className="dashboard-grid">{chart('culture', 'Cultures', 'culture')}{chart('religion', 'Religions', 'religion')}{chart('faith', 'Faiths', 'faith')}{chart('rite', 'Rites', 'rite')}</div>{table('culture_house', ['house', 'label', 'n'], 'Cultures by house')}{table('faith_house', ['house', 'label', 'n'], 'Faiths by house')}</>}
        {section === 'traits' && <>{chart('trait', 'Most common recorded traits', 'trait')}<p>Counts are distinct characters per trait; traits overlap. Missing trait records are not proof that a character had no traits.</p></>}
        {section === 'skills' && <><p>World uses the same non-dynastic filters, independently of dynasty and house. Each mean and median uses only recorded values. The leaderboard requires all six values.</p><GroupedBars title="Dynasty vs world" description="Mean and median stored values; hover for each sample size." labels={[...skillNames]} series={['selected', 'world'].flatMap(cohort => ['mean', 'median'].map(stat => ({ name: `${cohort === 'selected' ? 'Dynasty' : 'World'} ${stat}`, values: skillNames.map(s => { const r = skillRows.find(x => x.cohort === cohort && x.skill === s); return r?.[stat] == null ? null : Number(r[stat]); }), detail: skillNames.map(s => `Known values: ${display(skillRows.find(x => x.cohort === cohort && x.skill === s)?.n ?? 0)}`) })))} />
          <label>Skill for distribution and house comparison <select value={skill} onChange={e => setSkill(e.target.value)}>{skillNames.map(name => <option key={name}>{name}</option>)}</select></label><div className="dashboard-grid"><Breakdown title={`${skill} distribution`} rows={(results.skill_distribution ?? []).filter(r => r.skill === skill).map(r => ({ ...r, id: r.value, label: r.value }))} kind="skill" onDrill={next => setCategory({ ...next, skill, label: `${skill}: ${next.label}` })} /><GroupedBars title={`${skill} by house`} description="Mean and median; largest 15 houses with recorded values. Click a bar for members." labels={skillHouseRows.map(r => String(r.house))} series={['mean', 'median'].map(stat => ({ name: stat, values: skillHouseRows.map(r => r[stat] == null ? null : Number(r[stat])), detail: skillHouseRows.map(r => `Known values: ${r.n}`), drills: skillHouseRows.map(r => ({ kind: 'house', value: r.id == null ? null : String(r.id), label: String(r.house) })) }))} onDrill={setCategory} /></div><section className="card"><h2>Character leaderboard</h2><p>Sum of all six recorded skill positions. Select a character for details.</p><div className="bar-list">{(results.leaders ?? []).map((r, i, leaders) => {
            const score = skillNames.reduce((sum, name) => sum + Number(r[name]), 0);
            const maximum = Math.max(1, ...leaders.map(leader => skillNames.reduce((sum, name) => sum + Number(leader[name]), 0)));
            return <button key={String(r.id)} onClick={() => onCharacter(String(r.id))}><span>{display(r.name)} · {display(r.house)}</span><span className="bar-track"><span style={{ width: `${score / maximum * 100}%`, background: chartColor(i) }} /></span><b>{score}</b></button>;
          })}</div>{!results.leaders?.length && <p>No members have all six recorded skills.</p>}</section></>}
        {section === 'houses' && <><GroupedBars title="House population" description="Living and deceased members in the active cohort; largest 15 houses. Click a bar for members." labels={houseRows.map(r => String(r.label))} series={(['Living', 'Deceased'] as const).map(status => ({ name: status, values: houseRows.map(r => Number(r[status.toLowerCase()])), drills: houseDrills.map(d => ({ ...d, status, label: `${d.label} · ${status}` })) }))} stacked onDrill={setCategory} /><GroupedBars title="Recorded rulers by house" description="Positive current ruler evidence; missing evidence is unknown, not a non-ruler. Largest 15 houses." labels={houseRows.map(r => String(r.label))} series={[{ name: 'Recorded rulers', values: houseRows.map(r => Number(r.rulers)), drills: houseDrills.map(d => ({ ...d, ruler: 'Ruler' as const, label: `${d.label} · recorded rulers` })) }]} onDrill={setCategory} />{table('houses', ['label', 'n', 'living', 'deceased', 'rulers'], 'House directory')}{table('titles', ['title', 'holder', 'house'], 'Current titles held · first 100')}<p>Ruling members and titles are current positive evidence only, not historical ruler counts.</p></>}
        {drill && <section className="card"><div className="section-head"><div><h2>{drill.label} · characters</h2><p>{display(results.drill_count?.[0]?.n)} matching members. Click a name for details.</p></div><button onClick={() => setDrill(null)}>Close drilldown</button></div><div className="table-wrap"><table><thead><tr>{['name', 'house', 'status', 'age', 'culture', 'faith', 'ruler_status'].map(c => <th key={c}>{c.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{(results.drill ?? []).map(r => <tr key={String(r.id)}>{['name', 'house', 'status', 'age', 'culture', 'faith', 'ruler_status'].map(c => <td key={c}>{c === 'name' ? <button onClick={() => onCharacter(String(r.id))}>{r.name == null ? `Unknown character #${r.id}` : display(r.name)}</button> : display(r[c])}</td>)}</tr>)}</tbody></table></div><div className="pagination"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1}</span><button disabled={(page + 1) * 100 >= Number(results.drill_count?.[0]?.n ?? 0)} onClick={() => setPage(page + 1)}>Next</button></div></section>}
      </div>}
    </>}
  </>;
}
