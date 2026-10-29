# Developer notes

## Pipeline

`src/import.ts` inspects bytes, extracts the single `gamestate` entry, applies size/encoding and structural checks. `src/import.worker.ts` initializes Jomini and queries selected paths; `src/model.ts` normalizes them, and `src/database.ts` loads typed Arrow columns into in-memory DuckDB tables and runs UI-generated queries. The worker retains the source bytes for raw path inspection. Terminating it cancels work and releases its nested database worker. No raw save is stored in React state or browser persistence.

The import uses Jomini `typeNarrowing: 'none'` to preserve identifiers and CK3 date strings. Jomini groups duplicate keys into arrays; `records` collapses identical duplicate ID records and skips conflicting ones. Empty/missing sections produce empty datasets. Worker messages contain summaries and bounded query results, not full source documents.

## Model

IDs and `source_path` columns identify source records. `characters.house_id` joins `houses.id`, whose `dynasty_id` joins `dynasties.id`. Character `rite_id` joins `rites.id`, then `faith_id` joins `faiths.id`; faiths retain `religion_id`. Titles retain `holder_id`. `character_traits` and `relationships` are many-to-many link tables, not character counts. See the README for date, sex, status, landed and denominator rules. Rows are kept separate to avoid duplicating character counts in joins.

## Extending

1. Inspect representative save paths and verify the actual relationships; do not infer them from names or a single parser success.
2. Select the needed path in the import worker, normalize it in `model.ts`, preserve IDs and source paths, and model missing/unresolved values explicitly.
3. If adding numeric columns, add them to `numericColumns` so DuckDB uses a numeric type and the chart controls allow numeric aggregations.
4. Add focused synthetic tests, then test with local saves when available. Join many-to-many tables using distinct entity IDs when counting entities.
5. Add chart or table controls in `main.tsx` and validated SQL generation in `database.ts`. Never allow user-controlled identifiers or expressions to bypass validation, or allow queries to access remote files.

The SQL editor is intentionally absent: arbitrary DuckDB SQL would need a defensible read-only/external-access policy. The build emits local WASM and worker assets; do not switch to a CDN or add analytics.
