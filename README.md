# CK3 Save Analytics

A local-first, static browser application for examining supported plaintext Crusader Kings III saves. Save data is read, parsed and queried on your device. It is not uploaded or persisted by the application, and there is no account, backend, telemetry, or external data API. Dependencies, including DuckDB and Plotly, are bundled into the site.

## Run locally

Install Node.js 22.12+ or 24+ and npm, then:

```powershell
npm install
npm run dev
```

Open the displayed local address in Chrome or Edge. To test the production build:

```powershell
npm test
npm run build
npm run preview
```

The directory picker requires a Chromium browser with the File System Access API and a secure context (HTTPS or localhost). Other browsers can use the file picker or drag-and-drop. Directory access is explicitly requested, read-only, and limited to the chosen directory.

## Using the application

Choose a `.ck3` file, drag it onto the opening screen, or select an extracted plaintext `gamestate`. A local directory can also be selected and refreshed. Import runs in a worker; Cancel terminates that worker. Opening another save replaces the prior in-memory data. Closing or refreshing the page discards it.

The overview shows dataset sizes. In Dynasty Explorer, search for a dynasty or one of its houses and select a result. The overview, demographics, culture and faith, traits, skills and houses sections share the same filters. The dashboard shows population, recorded ruler evidence, demographics, culture and the religion → faith → rite hierarchy, trait prevalence, stored skills, house membership and current titles. Click a bar, sunburst segment, house, title or leaderboard name to inspect the relevant records. Drilldown lists are paginated. Filters and selection remain active while navigating the workspace; reset clears the filters.

An optional historical filter selects characters alive on a date, alive during a range, born during a range or deceased during a range. Dates use `year.month.day`; endpoints, including the recorded death date, are inclusive. Eligibility that cannot be established is excluded and counted separately. Dates `1.1.1`, `0.1.1` and `9999.1.1` are conservatively treated as possible placeholders; other plausible-looking dates can also be synthetic. Dates beyond the save date cannot establish eligibility. The world is only the retained characters in the save, so historical counts are not complete population reconstructions. Status, ruler evidence, sex, and age metrics still describe the snapshot or recorded death, not those attributes at the historical filter date.

Age is measured at the save date for living people and at death for retained deceased people. Age filters exclude missing ages. A mixed-status age distribution therefore combines two different measures, not the age of a population at one date. The historical living chart reconstructs known-alive members on January 1 of up to 50 decades and separately shows unknown eligibility; the active cohort filters still apply. The skill comparison uses the independently filtered parsed world, without the selected dynasty or house restriction. Each skill's mean and median use only its recorded values; the leaderboard requires all six skills. Trait counts are distinct characters and traits overlap. Categories and current titles may be limited to the first 100 results.

The generic Chart Builder and Data Tables retain their **separate advanced filters** and remain available alongside the dashboard. House names used as a fallback in the dynasty selector are identified as house names, not asserted dynasty names.

Optional game data: use **Game or localization folder** to select the local CK3 `game` folder. This supplies English localization and dynasty/house definitions, including cadet-house template names. An English localization folder or subdirectory can also be selected, but does not include those definitions. Selection is recursive in browsers supporting directory file selection. Selecting a folder after opening a save automatically reloads that save and resets the current in-memory dashboard session. Only relevant English YAML and dynasty definition files are read, with a 128 MiB limit on those files. Processing remains local; game assets are not shipped or saved. Without the matching game or mod data, unresolved source keys remain visible. See [Developer notes](DEVELOPER.md) for precedence and limitations.

Religion root colors are fixed application colors, not official game religion colors. Faith and rite segments use valid colors recorded in the save when available; missing or invalid colors have deterministic fallbacks.

The chart builder supports bar, horizontal and stacked bars, donut, line, histogram and scatter charts. It offers count, distinct count, sum, average, minimum and maximum, subject to field type; numeric charts use age or raw skill positions. Histograms use five-unit bins; scatterplots and categorical results are capped by the result limit. Grouping and sorting are available. Configurations remain only in the current page session.

Tables support search, two field filters, sorting, column selection, 50-row pagination and CSV export of all filtered rows and selected columns. Exports are limited to 128 MiB; narrow filters if the limit is exceeded. CSV nulls are blank, and potentially spreadsheet-executable text is prefixed with an apostrophe. Click a character row to inspect normalized details, traits, recorded relationships and held titles; links open related characters, houses, dynasties and titles. Raw explorer accepts a Jomini path, e.g. `/living/36959`; it displays an expandable tree with field-name search for bounded results, plus JSON text. Use a more specific path when a result is truncated.

## Supported formats and limits

- UTF-8 plaintext gamestate and ZIP saves containing a plaintext `gamestate`, including a CK3 header before the ZIP. The supplied local header-prefixed save and its extracted gamestate were tested.
- Binary/ironman, encrypted, non-UTF-8 and other unsupported formats are not supported. Import checks for binary data and reports errors; a plaintext export is required.
- Input is limited to 512 MiB and the ZIP's declared uncompressed gamestate size to 768 MiB. ZIP64 and archives with unusual structures are not guaranteed. Very large saves can still exceed available browser memory. The worker stores source bytes and normalized data; DuckDB adds another in-memory representation.
- Jomini's query API selectively materializes entity sections, not the entire hierarchy, but large character and title sections are materialized during import. Raw path inspection reparses the source and can be costly; do not query huge sections when a specific record will suffice.
- Structural brace/string validation catches common truncation, but Jomini is permissive and this is not a comprehensive syntax validator.
- A local headless Chrome check imported the supplied approximately 9.3 MiB compressed / 104.5 MiB extracted save in about 6 seconds, including table creation. This single-machine measurement is indicative only; browser memory and performance vary.

## Interpretation and limitations

The normalized datasets cover save metadata, characters from `living` and `dead_unprunable`, dynasties, houses, cultures, faiths, religions, rites, titles, dated title-history entries, traits, character traits, recorded family links, import diagnostics and top-level character field coverage. Sections and layouts not represented in those paths remain available only through raw paths. Title history is exposed as recorded date/holder pairs, not reconstructed tenures or proof of historical completeness. The model was checked against one modded local CK3 1.20.1.2 save; versions, mods and other save types may differ. Ambiguous duplicate character records are omitted with a warning; identical duplicate records are collapsed. Other omitted or pruned characters cannot be counted.

Membership follows character `dynasty_house` → house `dynasty` → dynasty ID. A matching founding-house name can supply a dynasty name. For cadet houses, the game's house template key resolves to its `name` localization key; absent a definition or localization, the source key remains visible instead of borrowing the dynasty name. Raw name, key and prefix fields remain available. Culture heritage and language are read from the save's culture records; missing pillars remain unknown. Rite references are resolved through `rites/database` to faiths, rather than equating rite IDs with faith IDs; nested `data.name` is used where present. Parent links marked derived reverse a recorded child link; they do not distinguish biological, adoptive or other parentage. Trait names are the zero-based entries of the save's `traits_lookup`; IDs are retained and this convention should be checked against additional game versions. Names can still be unresolved localization keys, especially when mods or required localization files are missing. Missing or unresolved IDs remain visible rather than being replaced with invented names.

Living/deceased status is determined by the source section. Age is completed years between birth and save date for living characters, or birth and recorded death date for deceased characters; missing, invalid, recognized placeholder and inconsistent dates produce null. `female=yes` means female; `female=no` or an omitted field on a complete record means male. For that default, a record must have a nonempty first name and a valid or recognized placeholder birth date; incomplete records and unrecognized `female` values remain unknown. `landed_data` or a current title-holder record is positive evidence for the recorded ruler filter; absence remains unknown, not a confirmed non-ruler. This is snapshot evidence, not proof of historical rule. Skill fields retain their numbered source positions; the semantic view maps them to diplomacy, martial, stewardship, intrigue, learning and prowess, in that order. These are stored skill values, not necessarily the total displayed in game after modifiers.

Counts are counts of parsed records after filters, not estimates of the entire game world. Count percentages use all filtered rows as the denominator, including missing values; only the configured top results are shown. Trait prevalence divides distinct characters with each trait by filtered characters; a person can have multiple traits, so percentages overlap. Distinct count excludes nulls. Grouped bars count category/group pairs, and donut proportions refer to displayed slices. Numeric aggregations ignore nulls.

The implementation does **not** yet provide a free-form SQL editor, whole-document raw field search, complete CK3 localization evaluation, full family inference, confirmed unlanded classification, or all requested related-record links. Raw-tree search only covers the current, untruncated path result. Generic Chart Builder interactions filter through the category breakdown rather than clicking a Plotly mark. Not every CK3 entity or field is normalized. See [PROGRESS.md](PROGRESS.md) for the current milestone and remaining backlog.

## Tests and private saves

`npm test` runs synthetic archive, parser and model tests. To include a local real-save integration test without committing that file:

```powershell
$env:CK3_INTEGRATION_SAVE = 'C:\path\to\your-save.ck3'
$env:CK3_LOCALIZATION_DIR = 'C:\path\to\game\localization\english'
$env:CK3_GAME_DIR = 'C:\path\to\game'
npm test
```

The tests do not require a real save or localization by default. The opt-in localization integration test expects the representative files and English keys of the installed game version used in development. `.gitignore` excludes `.ck3` files, files named `gamestate`, `example_saves/`, and `local-game-data/`; keep other private extracted material out of the repository too. Never upload or commit personal save data.

## Architecture and deployment

React/Vite runs the interface. An import worker uses fflate and Nick Babcock's JavaScript Jomini package, resolves supported references, and builds local DuckDB-Wasm tables using typed Arrow columns in a nested worker. Queries are generated from validated interface choices, not arbitrary SQL. Plotly renders the bounded results. [Developer notes](DEVELOPER.md) describe the data model.

The workflow in `.github/workflows/deploy.yml` builds, tests and deploys `dist` using GitHub Pages. Configure the repository's Pages source as GitHub Actions before deploying. Production builds under GitHub Actions derive the base path from the repository name (or use `/` for an owner root site); local builds use `/`. This workflow has not been published or validated on a remote Pages deployment.
