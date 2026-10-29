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

The overview shows dataset sizes. The dynasty explorer filters characters by dynasty and can group by house, culture, faith, age, status and other available fields. Its trait-prevalence category counts **distinct characters** per trait. Click a breakdown category to filter, and clear the category filter when finished. Search dynasties using an ID or a representative house name.

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

The normalized datasets cover save metadata, characters from `living` and `dead_unprunable`, dynasties, houses, cultures, faiths, religions, rites, titles, traits, character traits and recorded family links. Sections and layouts not represented in those paths remain available only through raw paths. The model was checked against one local CK3 1.20.1.2 save; versions, mods and other save types may differ. Ambiguous duplicate character records are omitted with a warning; identical duplicate records are collapsed. Other omitted or pruned characters cannot be counted.

Membership follows character `dynasty_house` → house `dynasty` → dynasty ID. Rite references are resolved through `rites/database` to faiths, rather than equating rite IDs with faith IDs. Parent links marked derived reverse a recorded child link; they do not distinguish biological, adoptive or other parentage. Trait names are the zero-based entries of the save's `traits_lookup`; IDs are retained and this convention should be checked against additional game versions. Culture templates and house names may be localization keys; optional game-file localization import is not implemented. Missing or unresolved IDs remain visible rather than being replaced with invented names.

Living/deceased status is determined by the source section. Age is completed years between birth and save date for living characters, or birth and recorded death date for deceased characters; invalid, missing, or future dates produce null. Sex is only assigned when an explicit `female=yes/no` is present, otherwise unknown. A character is marked landed when `landed_data` or a current title-holder record supplies positive evidence; absence remains unknown, not unlanded. Skill fields are numbered by their original array positions and are not given unverified semantic labels.

Counts are counts of parsed records after filters, not estimates of the entire game world. Count percentages use all filtered rows as the denominator, including missing values; only the configured top results are shown. Trait prevalence divides distinct characters with each trait by filtered characters; a person can have multiple traits, so percentages overlap. Distinct count excludes nulls. Grouped bars count category/group pairs, and donut proportions refer to displayed slices. Numeric aggregations ignore nulls.

The implementation does **not** yet provide a free-form SQL editor, localization imports, whole-document raw field search, full family inference, unlanded classification, or all requested related-record links. Raw-tree search only covers the current, untruncated path result. Chart interactions filter through the category breakdown rather than clicking a Plotly mark. Not every CK3 entity or field is normalized. These omissions and the known memory limits mean the full project brief is not yet complete.

## Tests and private saves

`npm test` runs synthetic archive, parser and model tests. To include a local real-save integration test without committing that file:

```powershell
$env:CK3_INTEGRATION_SAVE = 'C:\path\to\your-save.ck3'
npm test
```

The tests do not require a real save by default. `.gitignore` excludes `.ck3` files, files named `gamestate`, `example_saves/`, and `local-game-data/`; keep other private extracted material out of the repository too. Never upload or commit personal save data.

## Architecture and deployment

React/Vite runs the interface. An import worker uses fflate and Nick Babcock's JavaScript Jomini package, resolves supported references, and builds local DuckDB-Wasm tables using typed Arrow columns in a nested worker. Queries are generated from validated interface choices, not arbitrary SQL. Plotly renders the bounded results. [Developer notes](DEVELOPER.md) describe the data model.

The workflow in `.github/workflows/deploy.yml` builds, tests and deploys `dist` using GitHub Pages. Configure the repository's Pages source as GitHub Actions before deploying. Production builds under GitHub Actions derive the base path from the repository name (or use `/` for an owner root site); local builds use `/`. This workflow has not been published or validated on a remote Pages deployment.
