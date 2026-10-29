import * as duckdb from '@duckdb/duckdb-wasm';
import { Float64, Table, Utf8, vectorFromArray, type Vector } from 'apache-arrow';
import workerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import wasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import { numericColumns, type Tables } from './model';

const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
type Filter = { column: string; value: string };
type CategoryFilter = { column: string; value: string; isMissing: boolean } | null;

function filterClause(columns: string[], search: string, dynasty: string, includeDead: boolean, filters: Filter[], categoryFilter: CategoryFilter) {
  const where: string[] = [];
  if (dynasty && columns.includes('dynasty_id')) where.push(`${identifier('dynasty_id')} = ${literal(dynasty)}`);
  if (!includeDead && columns.includes('status')) where.push(`${identifier('status')} <> 'Deceased'`);
  if (search) where.push(`(${columns.map(column => `contains(lower(coalesce(cast(${identifier(column)} as varchar), '')), lower(${literal(search)}))`).join(' OR ')})`);
  for (const filter of filters) if (filter.value && columns.includes(filter.column)) {
    where.push(`contains(lower(coalesce(cast(${identifier(filter.column)} as varchar), '')), lower(${literal(filter.value)}))`);
  }
  if (categoryFilter && columns.includes(categoryFilter.column)) {
    where.push(categoryFilter.isMissing ? `${identifier(categoryFilter.column)} IS NULL` : `cast(${identifier(categoryFilter.column)} as varchar) = ${literal(categoryFilter.value)}`);
  }
  return where.length ? ` WHERE ${where.join(' AND ')}` : '';
}

function orderClause(columns: string[], sortColumn: string, sortDirection: string) {
  return columns.includes(sortColumn) ? ` ORDER BY ${identifier(sortColumn)} ${sortDirection === 'desc' ? 'DESC' : 'ASC'} NULLS LAST` : '';
}

export async function createDatabase(tables: Tables, onTable: (name: string) => void) {
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(wasmUrl);
  const connection = await db.connect();
  for (const [name, rows] of Object.entries(tables)) {
    if (!rows.length) continue;
    onTable(name);
    const columns = Object.keys(rows[0]);
    const vectors: Record<string, Vector> = {};
    for (const column of columns) {
      if (numericColumns.includes(column)) {
        vectors[column] = vectorFromArray(rows.map(row => typeof row[column] === 'number' ? row[column] : null), new Float64());
      } else {
        vectors[column] = vectorFromArray(rows.map(row => row[column] == null ? null : String(row[column])), new Utf8());
      }
    }
    await connection.insertArrowTable(new Table(vectors), { name, create: true });
  }
  return { db, connection };
}

export async function queryTable(
  connection: duckdb.AsyncDuckDBConnection,
  dataset: string, columns: string[], dimension: string, search: string, dynasty: string,
  includeDead: boolean, page: number, aggregation: string, measure: string, group: string, limit: number, sort: string,
  filters: Filter[], sortColumn: string, sortDirection: string,
  kind: string, categoryFilter: CategoryFilter, hasTraits: boolean,
) {
  const traitPrevalence = dataset === 'characters' && dimension === '__traits';
  if (!columns.includes(dimension) && !traitPrevalence) dimension = columns[0];
  if (!columns.includes(group)) group = '';
  if (!columns.includes(measure)) measure = '';
  if (!['count', 'distinct', 'sum', 'avg', 'min', 'max'].includes(aggregation)) throw new Error('Unsupported aggregation.');
  if (aggregation !== 'count' && !measure) throw new Error('Select a measure for this aggregation.');
  if (['sum', 'avg', 'min', 'max'].includes(aggregation) && !numericColumns.includes(measure)) throw new Error('This aggregation requires a numeric field.');
  if (['histogram', 'scatter', 'line'].includes(kind) && !numericColumns.includes(dimension)) throw new Error('This chart requires a numeric category.');
  if (kind === 'scatter' && !numericColumns.includes(measure)) throw new Error('A scatterplot requires a numeric Y measure.');
  const condition = filterClause(columns, search, dynasty, includeDead, filters, categoryFilter);
  const table = identifier(dataset);
  const totalResult = await connection.query(`SELECT count(*) AS n FROM ${table}${condition}`);
  const total = Number(totalResult.get(0)?.n ?? 0);
  const expression = aggregation === 'count' ? 'count(*)' : aggregation === 'distinct' ? `count(distinct ${identifier(measure)})` : `${aggregation}(${identifier(measure)})`;
  const groupSelect = group ? `, coalesce(cast(${identifier(group)} AS varchar), '(missing)') AS series` : '';
  const axis = kind === 'histogram' ? `floor(${identifier(dimension)} / 5) * 5` : identifier(dimension);
  const groupBy = group ? `${axis}, ${identifier(group)}` : axis;
  const order = sort === 'label' ? (numericColumns.includes(dimension) ? `${axis} ASC NULLS LAST` : 'label ASC') : 'n DESC NULLS LAST, label';
  const chartLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 20));
  const chartSql = traitPrevalence
    ? `SELECT concat(coalesce(t.trait, 'Unresolved'), ' [#', t.trait_id, ']') AS label, count(DISTINCT c.id) AS n FROM (SELECT * FROM ${table}${condition}) c JOIN character_traits t ON t.character_id = c.id GROUP BY t.trait_id, t.trait ORDER BY n DESC, label LIMIT ${chartLimit}`
    : kind === 'scatter'
    ? `SELECT cast(${identifier(dimension)} AS varchar) AS label${groupSelect}, ${identifier(measure)} AS n FROM ${table}${condition}${condition ? ' AND' : ' WHERE'} ${identifier(dimension)} IS NOT NULL AND ${identifier(measure)} IS NOT NULL LIMIT ${chartLimit}`
    : `SELECT coalesce(cast(${axis} AS varchar), '(missing)') AS label, ${axis} IS NULL AS is_missing${groupSelect}, ${kind === 'histogram' ? 'count(*)' : expression} AS n FROM ${table}${condition} GROUP BY ${groupBy} ORDER BY ${order} LIMIT ${chartLimit}`;
  const chartResult = traitPrevalence && !hasTraits ? null : await connection.query(chartSql);
  const rowOrder = orderClause(columns, sortColumn, sortDirection);
  const result = await connection.query(`SELECT * FROM ${table}${condition}${rowOrder} LIMIT 50 OFFSET ${page * 50}`);
  const rows = result.toArray().map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? null])));
  const chart = chartResult?.toArray().map(row => ({ label: String(row.label), count: row.n == null ? null : Number(row.n), series: group && !traitPrevalence ? String(row.series) : '', isMissing: Boolean(row.is_missing) })) ?? [];
  return { rows, chart, total, page };
}

export async function exportTable(connection: duckdb.AsyncDuckDBConnection, dataset: string, columns: string[], selected: string[], search: string, dynasty: string, includeDead: boolean, filters: Filter[], categoryFilter: CategoryFilter, sortColumn: string, sortDirection: string): Promise<Blob> {
  if (!selected.length || selected.some(column => !columns.includes(column))) throw new Error('Choose at least one valid column to export.');
  const condition = filterClause(columns, search, dynasty, includeDead, filters, categoryFilter);
  const reader = await connection.send(`SELECT ${selected.map(identifier).join(', ')} FROM ${identifier(dataset)}${condition}${orderClause(columns, sortColumn, sortDirection)}`);
  const encode = (value: unknown) => {
    const raw = String(value ?? '');
    const safe = typeof value === 'string' && (/^[\t\r\n]/.test(raw) || /^\s*[=+\-@]/.test(raw)) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const encoder = new TextEncoder();
  const parts: Uint8Array<ArrayBuffer>[] = [encoder.encode(`${selected.map(encode).join(',')}\r\n`)];
  let bytes = parts[0].byteLength;
  for await (const batch of reader) {
    const lines: string[] = [];
    for (const row of batch) lines.push(selected.map(column => encode(row[column])).join(','));
    if (!lines.length) continue;
    const part = encoder.encode(`${lines.join('\r\n')}\r\n`);
    bytes += part.byteLength;
    if (bytes > 128 * 1024 * 1024) throw new Error('CSV exceeds the 128 MiB export limit. Narrow the filters and try again.');
    parts.push(part);
  }
  return new Blob(parts, { type: 'text/csv;charset=utf-8' });
}
