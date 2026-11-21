# Platform (app platform concept)

Status: hypothesis. Built: nothing. Source: docs/concepts/INTAKE-2026-11-21.md section A (A1-A7).
Rigid order here: steps 1-2 only (names, concept records). No spec, no code, no release. Records: merged into catalog/nomenclature.jsonl and catalog/concepts.jsonl (commit ff3646a); supersede lines pkwzte, dbnrfa, cvmhly, xtqeuj, fgsoab merged in 0bacbb5. Operator answers of 2026-11-21 (Q1, Q4-Q6, Q11) are in inbox platform-kdrfsm (xkknwa->qfnbrw, mkohts->bxeoti, lojtwn->zthmeu, fgsoab->vjdkxo; new hnqzly, wkpcau), pending steward merge.

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

## Name map (nomenclature id, concept id; hypotheses PH1..PH18 live in the notes)
Collisions avoided on purpose with existing terms: protocol (docs/PROTOCOL.md) -> "platform protocol"; guard (xblxxs) -> "trace guard"; projection (gwokxx) -> "trace projection"; handler (ougcua) -> "platform handler" only in prose; transition (tag transition, transition gate) -> "event transition"; seam contract (lilgxn) is a policy seam shape, "platform contract" is a feature interface; rule/slot (UI) -> "look".

| area | nomenclature | concepts |
| --- | --- | --- |
| A1 | wdetyv platform; mtdmeu platform contract; judhvc core contract set; gallqf direct binding; ksycxw wasm component | hjltjz wasm-direct binding; qrlozs core contract set |
| A2 | kpeoqk protocol-first; fnnsez document fetch | cvycil protocol-first app |
| A3 | qzprxy platform protocol; lroksy protocol catalog; ywadlo protocol layer; botoyv default protocol; dvovnc enumerated invalidation; kctczv enumerable result set; nvnvjm regulatory protocol; xkknwa security suite (superseded by qfnbrw); hnqzly RSI-grade adversary | ghttaf protocol catalog; ydsgja enumerated invalidation; mvfezw enumerable result set; eeroue regulatory protocol records; lojtwn security suite records (superseded by zthmeu); wkpcau RSI-resistant surfaces |
| A4 | qyquih principal; mmcjnk delegation (superseded by xtqeuj); ougwwn ingested source; vwjhrd provenance; uchqmw view-server channel | kmfvny ingested distrust (superseded by cvmhly); viumxz automated view-server channel |
| A5 | lvdddu event record; hlfrjk event transition; otmnyz state timeline; cifgws as-of read; utavcr event queue; hgktns timestamp rule | dgtcqd event records; gsioti as-of state read |
| A6 | hcipca epoch pin; puaarp due comparison; mooazi at-time function; retmel scheduled function; ippsjr run trace; tdxcee trace guard; xdkblu trace projection; mkohts knockout (superseded by bxeoti) | vsbder epoch-pinned scheduling; tllxhx at-time and scheduled functions; gdhqxh trace guard knockout (chain gdhqxh, fgsoab, tail vjdkxo; see also survey yhmcoe early cutoff) |
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
Q1 ANSWERED 2026-11-21: "self-improvement-resistant surfaces" (A3) means resistant to a recursively self-improving (RSI) agent with high-level cryptographic solving and exploiting ability that breaks or exploits our system easily (hardened against AI-automated attack). Threat model: RSI-grade adversary; consequences in protocols.md PH18 and trust.md (no reliance on one primitive's secrecy, agility, post-quantum, no security through obscurity, restrictions stay options). Reading (a) kept as one property, not the meaning.
Q2 Scope: embedder runtime (own host, wasm engine) or layer over a browser (then JS glue exists at the edge)? "wasm does not bind through JS" differs between them.
Q3 Relation to harness: separate product or a way to express harness seams? Existing "seam contract" overlaps in spirit only.
Q4 DECIDED 2026-11-21 (operator left it to the platform): a trace guard reads a projection of a run trace (a view). The projected-versus-occurred alternative is dropped (time.md Kept).
Q5 DECIDED 2026-11-21 (operator: platform picks; cvmhly): provenance tagging and data-not-instruction are the default; any gate, allowlist or deny rule is an option, off by default.
Q6 DECIDED 2026-11-21 (operator left it to the platform, suggestion adopted): knockout voids only in-app derived state; an effect that left the app is irreversible and is declared guarded (released after its guard clears), compensated (compensating action recorded) or final (time.md PH15; vjdkxo).
Q7 A2 parenthetical "not header/SEO": read as the app is not a crawled document and uses no head metadata. Confirm.
Q8 Who may add or change catalog records (user, signed vendor, the app)? Ties to A4 and the RSI-grade threat model (PH18).
Q9 Wasm feature baseline (component model, GC, threads): survey later, outside this pass.
Q10 Explored records (docs/platform/explored-*.jsonl) have no catalog destination: catalog/README.md defines three catalogs (nomenclature, concepts, faults). Steward decision: add an explored catalog, or keep them as docs files.
Q11 RESOLVED 2026-11-21 (operator: platform picks): keep "candidate baseline" (pkwzte, dbnrfa); "settled" stays unproven (survey S7.1: WebGPU in four engines, no primary WebGL deprecation statement).
