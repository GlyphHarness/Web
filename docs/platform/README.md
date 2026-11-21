# Platform (app platform concept)

Status: hypothesis. Built: nothing. Source: docs/concepts/INTAKE-2026-11-21.md section A (A1-A7).
Rigid order here: steps 1-2 only (names, concept records). No spec, no code, no release. Records: merged into catalog/nomenclature.jsonl and catalog/concepts.jsonl (commit ff3646a); later changes are supersede lines in catalog/inbox/platform-hrmwqz.jsonl until the steward merges them.

## Goal (hypothesis)
An app context with V8-and-HTML-class capability whose abstraction points are contracts as data, so wasm is native and does not bind through JavaScript.
Not a browser page, not a harness module. Relation to the harness is open (Q2).

## Evidence
Survey passes (coarse; hypothesis evidence, not verified beyond what each states): docs/platform/survey-A3-A5.md with docs/platform/explored-A3-A5.jsonl (protocols, time); docs/platform/survey-A6-A7.md with docs/platform/explored-A6-A7.jsonl (time, look). Not yet surveyed: A1, A2, A4 (trust), Q9.

## Notes
| area | intake | note |
| --- | --- | --- |
| contracts, protocol-first | A1 A2 | contracts.md |
| protocol catalog | A3 | protocols.md |
| trust | A4 | trust.md |
| time | A5 A6 | time.md |
| look | A7 | look.md |

## Rules for every note
- Built and hypothesis are stated apart. Everything is hypothesis until the operator says build.
- Defaults, protocol lists and timestamp rules are catalog data read by the platform, not constants in a design.
- Rejected and unproven alternatives are kept with the reason ("Kept").
- Smallest contract set first; each addition names its cost.
- Evidence comes from `survey`, not memory. Names that appear below from memory are marked "unverified".

## Name map (nomenclature id, concept id; hypotheses PH1..PH17 live in the notes)
Collisions avoided on purpose with existing terms: protocol (docs/PROTOCOL.md) -> "platform protocol"; guard (xblxxs) -> "trace guard"; projection (gwokxx) -> "trace projection"; handler (ougcua) -> "platform handler" only in prose; transition (tag transition, transition gate) -> "event transition"; seam contract (lilgxn) is a policy seam shape, "platform contract" is a feature interface; rule/slot (UI) -> "look".

| area | nomenclature | concepts |
| --- | --- | --- |
| A1 | wdetyv platform; mtdmeu platform contract; judhvc core contract set; gallqf direct binding; ksycxw wasm component | hjltjz wasm-direct binding; qrlozs core contract set |
| A2 | kpeoqk protocol-first; fnnsez document fetch | cvycil protocol-first app |
| A3 | qzprxy platform protocol; lroksy protocol catalog; ywadlo protocol layer; botoyv default protocol; dvovnc enumerated invalidation; kctczv enumerable result set; nvnvjm regulatory protocol; xkknwa security suite | ghttaf protocol catalog; ydsgja enumerated invalidation; mvfezw enumerable result set; eeroue regulatory protocol records; lojtwn security suite records |
| A4 | qyquih principal; mmcjnk delegation (superseded by xtqeuj); ougwwn ingested source; vwjhrd provenance; uchqmw view-server channel | kmfvny ingested distrust (superseded by cvmhly); viumxz automated view-server channel |
| A5 | lvdddu event record; hlfrjk event transition; otmnyz state timeline; cifgws as-of read; utavcr event queue; hgktns timestamp rule | dgtcqd event records; gsioti as-of state read |
| A6 | hcipca epoch pin; puaarp due comparison; mooazi at-time function; retmel scheduled function; ippsjr run trace; tdxcee trace guard; xdkblu trace projection; mkohts knockout | vsbder epoch-pinned scheduling; tllxhx at-time and scheduled functions; gdhqxh trace guard knockout (superseded by fgsoab; see also survey yhmcoe early cutoff) |
| A7 | iyadab look; lehpou surface; trlyau shader spec; bgjxqr graphics baseline (superseded by dbnrfa) | hhwzgq look as data; wurhdd shader spec on settled baseline (superseded by pkwzte "shader spec on candidate baseline") |

## Cost ledger of additions (ground up)
Start: 6 contracts (clock, stream, store, surface, module, identity), 1 catalog, 0 protocols named in code.
| addition | cost |
| --- | --- |
| a contract | one data record + every binding must implement it; surface area attackers and versions must track |
| a protocol record | catalog growth; each needs a default decision; interop tests |
| state timeline | memory and retention policy for all versions |
| guard + knockout | dependency tracking between runs; undo semantics for external effects |
| shader spec | tie to one graphics baseline; fallback story |

## Open questions (for the steward; also listed in the reply)
Q1 "self-improvement-resistant surfaces" (A3): meaning unclear. Readings: (a) surfaces that code or a model ingested at runtime cannot rewrite to loosen its own limits (catalog and delegations immutable to the app); (b) surfaces hardened against AI-automated attack. Reading (a) is used in trust.md; operator to confirm.
Q2 Scope: embedder runtime (own host, wasm engine) or layer over a browser (then JS glue exists at the edge)? "wasm does not bind through JS" differs between them.
Q3 Relation to harness: separate product or a way to express harness seams? Existing "seam contract" overlaps in spirit only.
Q4 "guards project traces" (A6): used as "a guard looks at a projection of a run trace". Alternate: projected-versus-occurred as in flow lint (gwokxx). Confirm.
Q5 Trust vs CLAUDE.md: restrictions are options, off by default. Here "trust no ingested source" is hypothesised as provenance and data-not-instruction classification, with any enforcement tier as an option. Confirm.
Q6 Knockout of effects already external (message sent, payment made): voidable? Hypothesis: effects declare compensation or are non-voidable.
Q7 A2 parenthetical "not header/SEO": read as the app is not a crawled document and uses no head metadata. Confirm.
Q8 Who may add or change catalog records (user, signed vendor, the app)? Ties to A4 and Q1.
Q9 Wasm feature baseline (component model, GC, threads): survey later, outside this pass.
Q10 Explored records (docs/platform/explored-*.jsonl) have no catalog destination: catalog/README.md defines three catalogs (nomenclature, concepts, faults). Steward decision: add an explored catalog, or keep them as docs files.
Q11 PH17 "settled" baseline: survey S7.1 found WebGPU shipping in four engines but no primary WebGL deprecation statement; "settled" stays unproven (candidate baseline wording, pkwzte).
