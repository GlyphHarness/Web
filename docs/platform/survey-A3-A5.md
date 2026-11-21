# Survey A3 and A5 (coarse run, 2026-11-21)

Status: hypothesis evidence, not verified beyond what is stated. Records: docs/platform/explored-A3-A5.jsonl (13 explored records, 30 breadcrumbs). Catalog (merged): nomenclature rgnhri, rqkbvs, rzokfr, bfebtg, rgtztt, vbamkc, gwwknz in catalog/nomenclature.jsonl; concepts ictovp, mhvnlg, ztjmrd in catalog/concepts.jsonl.
Method: search first (standard), then the one best source per question. Budget 3 sources per area; a search is a source (operator ruling 2026-11-21, see Budget recount), so this pass overran it (A3 7 sources, A5 6). Fetched: A3 RFC 10024, RFC 9111 4.4, DPV repository; A5 MDN Event.timeStamp, XTDB blog, HLC paper (failed to load). Seven web searches gave leads (gist), taken beyond budget. Fetch answers were extracted by a small model from a prompt, so "concrete" means a primary page read through that extraction.

## Explored record
Defined as the `explored` catalog (intake B1), one JSON line per source looked at. Fields:
- `id` 6 letters; `concern` (area, question, short); `at` YYYY-MM-DD; `source` (url or path; for a search, the query).
- `kept` (<= 60 words): the kept blob, own words, noise filtered. `loc`: where in the source it came from.
- `unread`: ranges and linked pages not read, so a later run resumes there instead of refetching.
- `breadcrumbs` [{`target`, `gist` (<= 25 words), `confidence`, `deferred_because`}]; `supersedes`? (a change is a new line).
- A line in the catalog inbox also has `"to": "explored"`.
Names: explored record rgnhri, kept blob rqkbvs ("blob" alone means the skill blob (concept C10 of docs/concepts/CATALOG.md); hence "kept blob"), unread range rzokfr. Concept: explored catalog ictovp. Relation: collector vifitn (context inbox) removes exploring turns on the host; explored catalog does it for outside sources. Platform concepts it feeds: ghttaf, ydsgja, mvfezw, eeroue, lojtwn, dgtcqd, gsioti.

## Breadcrumbs
Names: breadcrumb bfebtg, source confidence rgtztt. Concept: deferred breadcrumbs mhvnlg.
- A breadcrumb names the blob it came from (the record it sits in), so its place is known.
- Confidence: `concrete` read and checked; `gist` seen in a summary (a search result or a listing); `inferred` from memory or context, with a search to confirm deferred. Own memory is never concrete.

## Coarse run
Names: coarse run gwwknz, concern rank vbamkc. Concept: ranked coarse run ztjmrd.
- Rank before any fetch: 1 function and features, 2 security, 3 nomenclature and what a name means for the product. Lower ranks wait.
- Per concern: grep catalog and inbox for covered ground, search (standard), the one best source, smallest blob; budget 3 sources per area. A source counts whether fetched or searched (each search and each result page relied on counts); concept nlwqzd, nomenclature fyhkvc.
- Every source, a search included, gets an explored record (a search is a source). If the query text was not kept, the record says so.
- Everything seen and not followed becomes a breadcrumb; no second pass without the operator or a concept record promoting the concern.
- Ranking applied here: A3 by S3.2 (function) and S3.1 (security) before S3.3 and S3.4; A5 S5.1 and S5.2 (function) before S5.3.

## Budget recount (2026-11-21)
Rule (operator): a web search is a way of fetching; a source from the web is a source. Searches count against the 3-sources-per-area budget; so does each result page relied on (none were: all result pages stayed unread, only search summaries were used). Recount from explored-A3-A5.jsonl:
| area | fetched | searched | counted before | counted now | budget | overrun |
| --- | --- | --- | --- | --- | --- | --- |
| A3 | 3 (qsmdre, aznodo, zkwyuo) | 4 (zxplio, gdqdyk, yxhqbt, pxkham) | 3 | 7 | 3 | 4 |
| A5 | 3 (npqhtm, uoisfy, bsnwuf failed) | 3 (rmyvsg, jumffu, rjlqui) | 3 | 6 | 3 | 3 |
- Evidence kept stays. Labelled taken beyond budget: all seven search records (A3 zxplio, gdqdyk, yxhqbt, pxkham; A5 rmyvsg, jumffu, rjlqui) and every answer cell resting on them (S3.1 deployment claims, S3.2 vendor purge, S3.3 ODRL and GPC relation, S3.4 whole answer, S5.1 spec minimums, S5.2 growth, S5.3 whole answer). The order of use was not kept; the three fetched pages are treated as the in-budget part because they are the primary evidence.
- Missing explored records for searches: none; all seven searches have one. Queries are kept as summarized terms, not verbatim strings.
- Counting note: bsnwuf is one source in the table but two fetch attempts (a 404 URL, then the PDF); the 404 returned nothing. Counting both attempts would make A5 7.
- No new source was fetched for this recount.

## Answers A3
| q | answer | confidence | records |
| --- | --- | --- | --- |
| S3.1 | Hybrid X25519MLKEM768 is standardized: RFC 10024, Standards Track, August 2026 (also SecP256r1MLKEM768, SecP384r1MLKEM1024). A vendor says it is the preferred group in most major browsers; its origin-side support went 0.5% to 12.8% (2023 to now). PQ certificate signatures (ML-DSA) and the CA/B Forum stance: not found. | RFC concrete; browser and share claims gist; certificates open | qsmdre zxplio |
| S3.2 | RFC 9111 4.4 invalidates by URI only (target, plus same-origin Location and Content-Location after an unsafe 2xx or 3xx): no enumeration. Tag purge (Fastly Surrogate-Key, Cloudflare and Akamai Cache-Tag) drops all members sharing a key; it needs the server to tag each response and is a vendor convention, not a standard. QUERY method and cursor connections: unverified. | RFC concrete; vendors gist | aznodo gdqdyk |
| S3.3 | Partial. W3C DPV (v2.3) is a vocabulary and ontology with an EU-GDPR extension and modules for 40+ countries; the only US entry is national, no state-law extension listed; ODRL is a policy language without legal content, a DPV-with-ODRL guide is in development. Global Privacy Control not verified. | DPV concrete; ODRL relation gist | zkwyuo yxhqbt |
| S3.4 | None found as a defined term. Closest meaning: the constraint layer sits outside the agent's writable scope and changes need a human or cryptographic gate (supports Q1 reading a). Preprints on governed self-modification exist, one with a self-reported result. | gist (search only) | pxkham |

## Answers A5
| q | answer | confidence | records |
| --- | --- | --- | --- |
| S5.1 | Event.timeStamp is a DOMHighResTimeStamp: ms from the global's time origin (navigation start in a window) to event creation. Resolution coarsened: Chrome 0.1 ms, Safari and Firefox 1 ms, 5 to 20 microseconds when cross-origin isolated, 16.667 ms under Firefox resistFingerprinting. One stamp per event; no per-transition times found (so a press-drag-release has no single record; the gap versus an event record). Coalesced and predicted pointer events not checked. Spec minimums (gist, search only): 100 microseconds, 5 when cross-origin isolated. | MDN-extracted part (timeStamp meaning, per-browser resolution, no per-transition times): concrete, record npqhtm. Spec minimums: gist, search record rmyvsg. Gap: partly inferred | npqhtm (concrete), rmyvsg (gist) |
| S5.2 | SQL:2011 defines system-time, application-time and bitemporal tables with AS OF reads. XTDB exposes them, keeps separate current and historical indices so current reads stay fast, and appends rather than rewrites. History is append-only, growth unbounded unless pruned; no compaction or retention policy found. Datomic: not covered. | XTDB concrete; growth gist | uoisfy jumffu |
| S5.3 | No single authoritative practice found. Wall-clock stamps alone can go backwards (leap seconds, steps); monotonic clocks are for durations on one machine; hybrid logical clocks (physical time plus logical counter) track NTP time and keep causality, with skew bounds (one vendor: 500 ms). The HLC paper could not be read. | gist | rjlqui bsnwuf |

## Deferred (30 breadcrumbs in the records; ranked, top first)
1. S3.1 PQ certificates: CA/B Forum and root programs on ML-DSA (inferred, no source seen).
2. S3.2 HTTP QUERY RFC and its cacheability; JSON:API or GraphQL cursor connections (inferred).
3. S5.2 retention and compaction of history: TDSQL VLDB paper, Datomic excision (gist, inferred).
4. S5.3 HLC paper text (the PDF is saved locally by the fetch tool; no readable text).
5. S5.1 Event Timing API and coalesced or predicted pointer events (inferred).
6. S3.1 browser versions and dates for the default group; Cloudflare Radar figure (gist, inferred).
7. S3.3 Global Privacy Control; DPV-with-ODRL guide; US state-law coverage (inferred, concrete pointer).
8. S3.4 Governed Individuation preprint, harness-tampering audit, vendor self-modification rule (gist), after Q1 is confirmed.
9. Vendor purge docs and essays, JUXT slides, other HLC notes (gist; low value).

## Open questions
- S3.1 second half and the browser-default claim need a second pass; promote or leave?
- Do searches count against the "sources" budget? Answered by the operator: yes (see Budget recount). Fetch-only counting in the first run was wrong.
- Q1 (README) now has literature backing for reading (a) only as gist.
- 2026 items (RFC 10024, the working draft dates) come from the fetched pages; no cross-check was run.
