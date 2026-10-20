# History filter parity

`historyRepository.find/count` (initial load, refresh and pagination) and
`matchesHistoryFilter` (incremental additions/updates) share this contract:

- Date bounds are inclusive. Only absent/null bounds are ignored; `0` is valid.
- Keywords are literal substrings of text or filename. Fold ASCII A–Z to a–z;
  non-ASCII characters remain case-sensitive. For example, `Hello` matches
  `hello`, `ÉCOLE` matches `École`, and `ПРИВЕТ` does not match `привет`.
  There is no accent removal, Unicode normalization or locale-specific folding.
- Empty keywords do not filter. Whitespace in a direct `HistoryFilter` is literal;
  the search UI's `createHistorySearchFilter` still trims its input.
- `%`, `_` and backslash are literal search characters, not SQL wildcards.
- Conditions combine with AND; values within type/display-kind/status lists
  combine with OR. Empty lists and false boolean flags do not filter.

ASCII folding matches SQLite's built-in `LOWER` on existing databases. Previously
JS folded Unicode while SQL folded only ASCII in stored values but Unicode in the
keyword. The shared input helper fixes both directions without new columns,
rewrites, indexes, native functions or filtering an already paginated result.
Full Unicode-insensitive search would require a separate storage/native design.

Intentional differences remain: `includeDeleted` is repository-only; the UI
predicate always excludes deleted rows. SQL uses materialized `displayKind`,
whereas JS derives it. Direct native writers must continue supplying that column.
Parity comparisons use persisted/round-tripped items to respect boolean,
filename, source and sync-status defaults. Ordering and pagination stay in SQL.

Run `npm test -- --runInBand src/__tests__/historyFilterParity.sql.test.ts
src/__tests__/historySourceFilter.sql.test.ts` with the repository's Node 22 and
installed better-sqlite3 native binding. These tests execute production SQL and
JS against the same rows; they do not establish native device validation.

Device acceptance still requires Android and iOS: search ASCII, Cyrillic and
accented text/filenames; add/update matching and nonmatching records while the
filter is active, then refresh and compare records/counts. On iOS also write via
the share/keyboard extension and repeat. The direct-write SQL test covers the
row contract, not execution of Swift or the actual shared App Group database.
