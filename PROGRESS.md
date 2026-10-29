# Implementation progress and handoff

## Milestone 1 — COMPLETE

The bounded acceptance criteria are satisfied. This checkpoint does not claim that every possible CK3 record, localization expression or future analytical question is supported.

- [x] **Historical dates:** inclusive alive-on, alive-during, born-during and died-during filters distinguish true, false and unknown; historical age and age-at-death helpers require a consistent, recorded lifetime. Invalid and recognized placeholder dates are flagged; retained/pruned records limit historical coverage.
- [x] **Core analytics:** typed character filters and independent selected/world/rest cohorts; ID-based character → house → dynasty joins; whitelisted metrics and grouping by house/dynasty; character, house, dynasty, title, trait and relationship grains. Trait/relation filters use existence checks, and entity counts use distinct IDs. DuckDB tests execute representative cross-entity queries and check denominators and duplicate-link cardinality.
- [x] **Localization and interpretation:** valid complete records with omitted `female` are male; invalid/incomplete records remain unknown. Explicit and embedded house names take precedence, with a resolvable dynasty name as fallback. Principal entities support optional local game localization, direct names and safe unresolved/dynamic-expression fallback without bundling game files.
- [x] **Diagnostics:** selected missing references, date-quality issues, omitted records, observed source fields and section coverage are reported. This is a bounded diagnostic inventory, not an exhaustive recursive validator.
- [x] **Verification:** synthetic tests, real DuckDB-Wasm joins, the supplied modded CK3 1.20.1.2 gamestate and local English localization were exercised; production build and browser import/worker-query checks passed.
- [x] Existing import, cancellation, chart builder, data tables, CSV export and raw explorer remain available. No genealogy viewer or major dashboard was added during completion.

See [DEVELOPER.md](DEVELOPER.md) for schema, source paths, query API, denominator definitions, localization precedence and historical caveats. Ruler classification is positive evidence or unknown; missing evidence is not a confirmed non-ruler.

## Technical backlog — not Milestone 1 blockers

- Broaden save-version/mod validation, ruler and negative-evidence classification, trait-index verification, synthetic-date identification and source-field coverage.
- Expand CK3 dynamic localization/load-order support, unresolved-label presentation and additional modded names without distributing game assets.
- Add more analytical operations, dimensions, non-character-centered cohort definitions, reusable time-series helpers and multi-save identity/provenance where needed.
- Extend family, title, government and realm extraction and add richer diagnostics and performance testing.

## Milestone 2 — Dynasty BI — COMPLETE

- [x] Add shared dashboard filters, reset and paginated character drilldowns, retaining unknown ruler and historical eligibility.
- [x] Add overview, demographics, culture/faith/rite hierarchy, houses, recorded titles, traits and stored-skill comparisons. No trait categories are inferred without reliable source metadata.
- [x] Compare selected and independently filtered world skill values and house skills using per-skill known-value denominators; reconstruct a bounded, explicitly incomplete historical population series.
- [x] Automated DuckDB and UI interaction tests, real-save/localization integration tests, production build and browser verification with the supplied gamestate.
- [x] Follow-up: resolve founding and cadet house names using selected game definitions, expose recorded culture heritage/language, improve comparative charts and keep dashboard content in place during filter updates.
- [x] Follow-up: resolve religion types and numeric house templates against selected game data; reload an open save when that selection changes; use stable religion colors and recorded faith/rite colors.

Further work is backlog, not a Milestone 2 blocker: extend localization and trait categorization when reliable metadata is available; improve ruler evidence; expand historical coverage, chart accessibility and result pagination beyond current limits; and broaden browser/save-version performance testing.

## Later milestones

- [ ] Milestone 3: canonical ID-based bounded genealogy graph and focused viewer, including cross-dynasty relationships and pruning.
- [ ] Milestone 4: evidence-based historical political analysis, multi-save comparison, richer genealogy layouts and reusable character/realm analytics.
