# Look (A7)

Status: hypothesis. Built: nothing. Evidence: docs/platform/survey-A6-A7.md (S7.1-S7.3, 2026-11-21) and docs/platform/explored-A6-A7.jsonl; coarse, secondary in part. Directive: the graphics API is taken from evidence, not memory; any name below is an unverified candidate.

## Terms
look, surface, shader spec, graphics baseline. Harness page terms (slot, rule, theme tokens) are page-only and unrelated.

## Shapes (hypothesis)
- surface contract (core set, contracts.md): nodes (create, parent, remove), look binding, draw, input regions (feeds event records, time.md).
- look rule (data): selector, properties, order or specificity, origin (platform, app, user). Cascade, custom properties and layout (box, flow, grid-like) are the open size of "CSS-like". Which subset is the first open question; not decided here.
- shader spec (data): stages (vertex, fragment, compute), entry points, bindings (buffers, textures, samplers, with layouts), language reference, target baseline id.
- graphics baseline (dbnrfa, supersedes bgjxqr; catalog record): api, shader language, status per implementation, evidence (source, date), successor note. A record, so a change in the browser community's consensus is a data change.

## PH16 look as data (hhwzgq)
Claim: CSS-like rules held as data and applied through the surface contract give HTML-class styling without a document or JavaScript.
Holds if: a screen of a small app (text, boxes, input, themed colors) renders from rule records plus nodes only; the same records render on two bindings; a theme change is a record change.
Replaces: HTML documents plus CSSOM scripting.
Cost: a style resolution and a layout engine in the platform (large); font and text shaping come with it; accessibility mapping (flagged in contracts.md).

## PH17 shader spec on candidate baseline (pkwzte, supersedes wurhdd)
Claim: a shader spec written against a candidate GPU API baseline ports across implementations of it.
Evidence (survey-A6-A7.md S7.1, source date 2025-11-25): WebGPU ships in four engines with platform gaps; no primary WebGL deprecation statement found; WGSL is a W3C CRD (gist). Candidate baseline: WebGPU with WGSL.
Holds if: one spec renders the same test image on two implementations of the baseline within a stated tolerance, and the baseline record cites its evidence and date.
Replaces: ad hoc WebGL-style context state and per-engine shader strings.
Cost: tie to one baseline and a fallback story for hardware or implementations lacking it; spec must move when the baseline record moves.
Unproven: "settled" as a single answer. Evidence so far fits the split (WebGPU for new work, WebGL kept for old); a Khronos or W3C primary statement is still needed (survey-A6-A7.md open item 2).

## Kept (rejected, reasoning only)
- Defining shaders in prose or as source strings only: rejected, the contract must be data (bindings and stages inspectable).
- Inventing a new shading language: rejected for now; cost and no evidence of need.
- Picking WebGPU "because it is newer": rejected by directive; evidence first.

## Survey questions (A7; budget 3 sources; coarse)
S7.1 State of the GPU API across browsers in 2026: which of WebGPU and WebGL ship in Chrome, Firefox, Safari (engines on desktop and mobile), is WebGL in maintenance or being deprecated, is there a named successor or level-2 effort at the W3C GPU for the Web group, and which shader language does it use (candidate, unverified: WGSL). Answer per item: shipping, partial, none; source and date.
S7.2 Outside browsers: which GPU API and shader language do the cross-platform native implementations and engines target (candidates, unverified: wgpu, Dawn, Naga, Tint, SPIR-V), so a spec stays portable out of the browser? One line each.
S7.3 What did the web platform settle for styling beyond core CSS in 2026 (candidates, unverified: Houdini paint and properties-and-values, container queries, nesting, scope), and is there any standard declarative or JSON form of a style sheet or Typed OM that a non-JS runtime could read? Report: settled, experimental, abandoned.
Defer: text shaping, font formats, color management, accessibility, video.
