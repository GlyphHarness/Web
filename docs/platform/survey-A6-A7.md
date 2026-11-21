# Survey A6 and A7 (coarse pass, 2026-11-21)

Records: `docs/platform/explored-A6-A7.jsonl` (8 explored records; wtsgpk is the S7.1 W3C, Khronos and trade search). Catalog (merged, `catalog/nomenclature.jsonl` and `catalog/concepts.jsonl`): nomenclature tjuwez (early cutoff) and bkrsad (misfire policy; superseded by mzqhdl in inbox `catalog/inbox/survey-kwtbpe.jsonl`, pending merge), concept yhmcoe (hypothesis). Budget 3 fetched sources per area; search snippets are marked gist.
Platform ids linked, not duplicated: vsbder (PH13), tllxhx (PH14), gdhqxh (PH15), gsioti (PH12), hhwzgq (PH16), wurhdd (PH17), hcipca, mkohts.

## Kept and deferred
| source | area | confidence | kept |
| --- | --- | --- | --- |
| Quartz lesson 4 | S6.1 | concrete | misfire defined; named policies absent |
| Quartz misfire search snippets | S6.1 | gist | cron policies: fire once now, do nothing, ignore |
| rustc dev guide, incremental compilation | S6.2 | concrete | red-green, early cutoff, reads-derived dependencies |
| Wikipedia FRP | S6.3 | concrete | behavior vs event, system names |
| web.dev WebGPU support | S7.1 | concrete | shipping table, 2025-11-25 |
| W3C and Khronos and trade search snippets (record wtsgpk) | S7.1 | gist | WGSL CRD; WebGL not formally deprecated in any source seen |
| wgpu readme | S7.2 | concrete | backends, WGSL, Naga |
| MDN Houdini | S7.3 | concrete | status per Houdini API |

Deferred breadcrumbs: 22 listed across 8 records (11 gist, 11 inferred; per record 1, 5, 3, 1, 4, 2, 3, 3). Record wtsgpk repeats three gist targets first noted under bdlcwy (W3C activity page, Khronos SIGGRAPH page, trade commentary), so 19 are distinct. Not followed: Build Systems a la Carte (PDF fetch failed), sagas, timing wheels, Temporal replay, Dawn/Tint, Baseline status of container queries/nesting/scope.

## Answers
### S6.1 Epoch-aligned intervals and catch-up
- Epoch alignment is standard in stream processing: Flink tumbling windows align to the epoch by default with an optional offset (gist, snippet); window index floor(t / size) appears in a 2026 Kafka Streams paper (gist). This matches the epoch pin (PH13). The offset parameter is the data knob for time zones; the platform should keep it in the timestamp rule.
- Catch-up policy has precedent as a per-trigger named policy (Quartz misfire): fire once now then resume, skip to next tick, fire all missed, plus a smart default (gist; Quartz lesson 4 only defines the misfire). This matches skip, coalesce, run-all in time.md, with "default by trigger type" as catalog data.
- Pitfalls (leap seconds, clock steps, load spikes from aligned ticks, timing wheels): not covered. Open.

### S6.2 Dependency-driven knockout
- Reads-derived dependencies with early cutoff are established (rustc red-green): dependents re-run only if a recorded read changed, and a re-run with an identical result hash stops propagation. This supports "dependency derived from reads" (PH15) and suggests a refinement: knockout and replay should apply early cutoff (concept yhmcoe).
- External effects that cannot be undone: not answered. The rustc page does not discuss side effects. Sagas and compensation (inferred, not read) are the named lead for Q6.
- Glitch freedom and truth maintenance: deferred.

### S6.3 At-time vs scheduled precedent
- Closest precedent: FRP behaviors (values sampled at a time, at-time) versus events (discrete occurrences). Names: Yampa, Reactive, reflex, reactive-banana, Sodium, Flapjax. Not an exact match for "scheduled function = at-time function plus pinned trigger"; the mapping is by analogy. Workflow engines with replay (Temporal) are inferred, not read.

### S7.1 GPU API in browsers (source date 2025-11-25)
- WebGPU: Chrome/Edge desktop shipping (144 listed; Windows, macOS, ChromeOS; Linux in progress); Chrome Android shipping (121, Android 12+, Qualcomm/ARM only); Firefox partial (141 Windows, 145 macOS ARM64; Linux, Intel Mac, Android in progress); Safari shipping (26 on macOS, iOS, iPadOS, visionOS). All four engines ship it, with platform gaps.
- WebGL: no formal deprecation or maintenance-mode statement found in a primary source; a May 2026 commentary calls it a legacy fallback (gist, secondary). WebGPU is described as its successor. Level-2 or named successor effort: not found. Unproven: "settled = single answer"; evidence so far says WebGPU is the new-work API and WebGL remains for old content, matching the PH17 "split" caveat.
- Shader language: WGSL, W3C Candidate Recommendation Draft, published twice in 2026 (gist, record wtsgpk; W3C activity page not opened).

### S7.2 Native implementations
- wgpu (Rust): native Vulkan, Metal, D3D12, OpenGL; wasm WebGL2 or WebGPU; shader language WGSL, translated by Naga per backend; its readme notes the WebGPU and WGSL specs are drafts (concrete). Dawn with Tint (Chromium) and SPIR-V as an interchange: inferred only, not read.

### S7.3 Styling beyond core CSS
- Houdini on MDN: Properties and Values, Typed OM, Painting API, Worklets documented without a status note; Layout API partial in Chrome Canary; Parser API and Font Metrics proposals only (concrete as a listing; per-browser support not read). Container queries, nesting, scope: not checked. No JSON or declarative sheet form for a non-JS runtime found; Typed OM is a JS API. Settled/experimental/abandoned verdicts need MDN compat tables or Baseline.

## Confidence
Concrete: rustc red-green, FRP names, web.dev table, wgpu backends, Houdini list. Gist: Quartz named policies, Flink and Kafka alignment, WGSL status, WebGL commentary. Inferred: build systems, sagas, timing wheels, Temporal, Dawn/Tint, SPIR-V, Baseline status.

## Open questions
1. S6.2 external effects (Q6): sagas or compensation needs a second pass.
2. S7.1 WebGL: need a Khronos or W3C primary statement (Khronos SIGGRAPH 2026 page, Chrome "next for WebGPU").
3. S7.3: container queries, nesting, scope Baseline status and a declarative style form; MDN compat tables or web.dev Baseline.
4. S6.1 pitfalls (leap seconds, clock steps) uncovered.
5. Whether PH17 may cite web.dev (2025-11-25) as "settled" evidence: it shows shipping in four engines, not that WebGL is retired.
