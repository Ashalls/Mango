# Mango — Feature Audit vs Studio 3T, Compass, NoSQLBooster

Baseline: Mango v0.6.7. Comparison set:
- **Studio 3T** — the high-end commercial benchmark, paid.
- **MongoDB Compass** — the free official client.
- **NoSQLBooster** — mid-tier, scripting-heavy.

The goal is to identify gaps where filling them would close the "I still need Studio 3T for X" objection.

---

## What Mango already has (don't rebuild these)

| Feature | Mango | Studio 3T | Compass | NoSQLBooster |
|---|---|---|---|---|
| Tree explorer (conns/dbs/cols) | ✓ | ✓ | ✓ | ✓ |
| Document grid + JSON view (Monaco + AG Grid) | ✓ | ✓ | ✓ | ✓ |
| Visual query builder (filter/sort/proj) | ✓ | ✓ | ✓ | partial |
| Drag-and-drop filter building | ✓ | ✓ | – | – |
| Aggregation editor with stage-by-stage preview | ✓ | ✓ | partial | ✓ |
| Index list / create / drop | ✓ | ✓ | ✓ | ✓ |
| Index usage stats | ✓ | ✓ | ✓ | partial |
| Query profiler (`system.profile`) | ✓ | ✓ | – | ✓ |
| Explain plan (`allPlansExecution` + visual) | ✓ | ✓ | ✓ | ✓ |
| Value search across collections | ✓ | ✓ | – | – |
| Cross-DB migration tool | ✓ | ✓ | – | partial |
| mongodump/mongorestore wrapping | ✓ | ✓ | – | ✓ |
| JSON/CSV/NDJSON export | ✓ | ✓ | ✓ | ✓ |
| Embedded mongosh launcher | ✓ | ✓ (IntelliShell) | ✓ | ✓ |
| SSH tunnel | ✓ | ✓ | ✓ | ✓ |
| TLS (CA/cert/key + passphrase) | ✓ | ✓ | ✓ | ✓ |
| Connection folders | ✓ | ✓ | partial | ✓ |
| Read-only / production gating | ✓ | partial | – | partial |
| Per-database write access controls | ✓ | – | – | – |
| AI assistant with DB tools | **✓ (unique)** | – | – | partial (script gen) |
| Auto-updates | ✓ | ✓ | ✓ | ✓ |
| Cross-platform installer | ✓ | ✓ | ✓ | ✓ |

Mango already covers the entry-level + mid-tier feature set. The Claude integration and per-DB write gating are genuine differentiators.

---

## Gaps where Studio 3T users would notice the absence

### Top 5 — fill these to be "good enough to switch" for most users

**1. Schema Explorer with field statistics, type distribution, and outlier detection.**
Studio 3T's "Schema Explorer" and Compass's "Schema" tab analyze a sample (1k-10k docs) and show per-field: presence %, type breakdown, value histogram, min/max/quantiles for numerics, top-N for strings. Mango has `mongo_collection_schema` (MCP-side) but nothing visual. This is the single most-requested feature in MongoDB GUIs.
*Implementation effort: low.* You already sample documents in `explorer.collectionSchema`; add a renderer component that renders the per-field stats with bar charts, and add type-mismatch flags (e.g. `userId` is mostly `string` but 4% are `ObjectId`).

**2. SQL ↔ MongoDB query translator.**
Studio 3T's `SQL Query` tab is one of the top reasons enterprises license it. Users paste `SELECT … FROM orders WHERE total > 100 GROUP BY status` and get the aggregation pipeline. Mango has the unfair advantage of an embedded LLM — wire a "Paste SQL" panel that pipes through Claude with a constrained system prompt → produces a pipeline → drops it straight into the aggregation editor (which already does stage-preview). Marketing-friendly, technically trivial.

**3. Collection compare / diff (and sync).**
Studio 3T's `Tasks → Compare collections` does row-level diff between two collections (same or different connections) — invaluable for staging vs prod sanity checks. Mango already has cross-connection plumbing in the migration tool; reuse it. Output a 3-pane view (only-in-A / only-in-B / different) with per-doc diff. The MCP `mongo_changelog` is the rollback half of this story — a diff view is the inspection half.

**4. JSON Schema validation editor.**
Compass surfaces `$jsonSchema` validation rules in a dedicated tab. Mango currently has no UI for `db.runCommand({collMod: ..., validator: ...})`. Add a "Validation" tab on each collection with a Monaco-edited JSON schema, a "validate sample" preview that runs the schema against existing docs, and the apply button. With your codegen infrastructure this fits in one afternoon.

**5. Charts & visualizations.**
Compass has a basic "Documents → Chart" path; Studio 3T has a Charts tab. Even minimal — bar/line/pie from an aggregation result — would close a real workflow gap (today the answer is "export CSV, open in Excel"). Hook AG Grid's data into Chart.js or Recharts. The aggregation editor already produces grouped data.

### Tier 2 — quality-of-life wins

**6. Real-time cluster metrics dashboard.**
Compass's "Performance" tab shows ops/sec, network throughput, queue depth, slowest ops live. Mango has the profiler (historical) but no live view. `db.serverStatus()` polled every 2s + a few sparkline charts gets you most of the way.

**7. Replica set / sharded cluster topology view.**
Studio 3T draws the topology (`rs.status()`, `sh.status()`) and shows lag per secondary, shard balancer state, chunk distribution. For DevOps-heavy users this is "must have." Read-only, low risk.

**8. Server-wide command runner / "Free-form mongosh in a tab" instead of spawning a terminal.**
Mango shells out to mongosh in a separate terminal window (`mongosh.ts`). Studio 3T's IntelliShell is an in-app terminal with autocomplete + history. Embedding a real mongosh REPL inside the app (via `node-pty` + a terminal renderer like xterm.js) is a known well-trodden pattern and removes the "I have to switch windows" friction.

**9. Saved queries / query bookmarks.**
You have `queryHistory` server-side. Surface it as a left-pane "Saved & Recent" list with named bookmarks, similar to Studio 3T's "Favorites." Cheap, very sticky once users start saving.

**10. Multi-tab querying.**
Today Mango appears to be single-pane per collection. Studio 3T users keep 6-10 tabs open. Add a tab strip above the document grid with persistence across sessions. Bigger UX lift but expected at this tier.

**11. In-place document editing in the grid.**
The doc editor exists, but Studio 3T also offers cell-level editing directly in the grid (double-click → edit → save). AG Grid supports this natively; you'd need to plumb the per-cell change back into an `$set` update. Combined with the changelog/rollback that already exists this is safer than Studio 3T's version.

**12. Bulk update / find-and-modify dialog.**
There's a `BulkToolbar.tsx` and `UpdateManyDialog.tsx` — confirm coverage; Studio 3T users expect "select 30 docs in grid → apply transform → preview → execute." If selection-driven bulk update isn't wired, finish that loop.

**13. Database-level GridFS browser.**
Studio 3T browses `fs.files` / `fs.chunks` as a file tree with download/upload. Niche but called out repeatedly in 3T-vs-X reviews.

### Tier 3 — enterprise / compliance

**14. Data masking on export.**
Studio 3T offers field-level masking on export (hash, redact, fake). For users pulling production data into staging, this is the only legal way. With your existing export worker, this is a serializer hook with a "rules" UI.

**15. Atlas integration.**
Compass auto-connects to Atlas clusters with OAuth and lists clusters by project. Studio 3T does this via API key. Mango requires the user to paste the SRV URI by hand. Adding the Atlas API client (read-only listing + connect) would shave a real friction point.

**16. LDAP / Kerberos / x.509 auth UI.**
TLS/SSH is wired. `MONGODB-AWS`, `GSSAPI`/Kerberos, LDAP `PLAIN`, `MONGODB-X509` are the auth mechanisms enterprises use that aren't currently exposed in the connection dialog (driver supports them out of the box; it's pure UI work).

**17. Scheduled tasks / cron exports.**
Studio 3T's "Tasks" can schedule recurring exports/imports/migrations. Electron + node-cron + your existing migration/export workers. Solves the "I run a nightly dump from prod" use case.

**18. Audit log export / SIEM hookup.**
The `changelog` service exists for Claude-driven writes. Extend to all writes (regardless of source), allow filtering, and add an "Export audit log" command that produces a CSV/JSON suitable for handing to security review. Pairs well with the security audit's recommendation to log all writes centrally.

### Tier 4 — AI-native moves that competitors *cannot* match

Mango's structural advantage is the embedded LLM with MCP tools. Lean into it where 3T physically can't follow:

**19. "Explain this collection" / "Recommend indexes" one-click action.**
Right-click a collection → Claude reads the profiler's slow-query log + samples docs + (if linked codebase) scans for query patterns → produces an indexed-recommendations report with `db.createIndex()` snippets. You already have all the building blocks; this is a single prompt template.

**20. Schema drift detector.**
Periodically sample two collections (or same collection over time) and have Claude summarize what changed. With the changelog this becomes "alert me if a write changes the shape of a doc that historically had 8 fields and now has 9."

**21. Natural-language query → aggregation pipeline + visual preview.**
Already half-built (Claude can call `mongo_aggregate`), but make it a first-class UI: a NL search bar at the top of the doc grid that produces an aggregation, drops into the stage editor, and the user can tweak. Compass's "AI" feature does this online; yours runs locally through the user's existing Claude sub.

**22. Conversational ETL.**
"Migrate `users.email` → lowercase, drop duplicates, copy to staging." Claude orchestrates: read sample → propose pipeline → preview → confirm → execute through MCP with the changelog tracking. This is the migration tool, but voice-driven. Studio 3T's "Tasks" is a manual version of this.

**23. AI-assisted query optimization.**
Run `explain('allPlansExecution')` → feed to Claude with the index list → get a human-readable "your query is doing a COLLSCAN because field X isn't indexed" with the exact `createIndex` call. The MCP tools `mongo_explain` and `mongo_index_stats` already feed this.

**24. Smart data fixer.**
Surface the profiler's slow queries + the type-mismatch outliers (from the new schema explorer) and offer "Have Claude propose fixes" — bulk normalize types, fill missing fields, etc. All via the existing changelog so the user can roll back.

---

## What to skip / what's marginal

- **Tree view diagrams of relationships (`@xyflow/react` is already a dep).** I see the dep but no apparent visual schema diagram. Skip until users ask — Compass dropped its diagram view in favor of just the schema-stats tab.
- **Multiple themes beyond dark/light/system.** Not asked for; the current setup is fine.
- **Mobile / web build.** Electron-only is correct for a tool that opens local SSH keys.
- **Code-first replacement for the connection string editor.** Studio 3T's manual "Connection Builder" tab is largely there because their string parser is bad; yours uses `new URL()` which is good enough.

---

## Suggested roadmap if you can ship ~6 features in the next quarter

1. **Schema explorer with type stats** (item 1) — biggest single perceived gap.
2. **JSON schema validation editor** (item 4) — quick win, enterprise box-ticker.
3. **Collection compare** (item 3) — reuses migration plumbing, hugely sticky.
4. **In-app mongosh** (item 8) — removes the only "I jumped out of Mango" moment in the daily flow.
5. **"Recommend indexes" Claude action** (item 19) — flagship demo of why an AI-native MongoDB client matters.
6. **Charts on aggregation results** (item 5) — closes the export-to-Excel loop.

After those, the app meaningfully competes with Studio 3T at $0; the AI features then become net-new capability that nobody else has.
