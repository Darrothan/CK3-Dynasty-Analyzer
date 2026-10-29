# Implementation progress

- Implemented local import, selective Jomini parsing, core normalized datasets, DuckDB-Wasm queries, chart/table interfaces, raw path inspection, worker cancellation, and static Pages workflow.
- Verified synthetic fixtures plus the supplied header-prefixed CK3 save and extracted plaintext gamestate, including browser import and analytics. See README for the repeatable tests and exact limitations.
- Remaining work: whole-document raw search, richer drilldowns and related-record navigation, optional game-file localization, expanded semantic coverage, more real-save/version validation, and safe read-only SQL exploration. Trait index semantics and other version-specific mappings need further validation.
