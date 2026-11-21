# B2 Platform edges

Project: the app platform concept (the one project `docs/platform/` names). Where B1 builds the spine, B2 takes the edges: trust (PH9, PH10), the protocol records that carry rules (PH7, PH8), the mapping of the harness query surface onto the platform's result sets (`docs/platform/query-surface.md`, P-Q1 to P-Q6), look as data and the shader spec (PH16, PH17), and a second app, "reviewer", that reads the harness's records through the platform. Plan only; nothing started. Conventions: `README.md` in this folder.

## Status and gates
The concept's status (hypothesis only, nothing built, the operator says build) holds, as in B1. B2.1 to B2.4 are notes, surveys and paper checks. From B2.5 on: gate GB (B1) and, for the query mapping, G1 (README section 3). B2 can start its notes stories while B1's notes run, since the files differ (trust, look and the query mapping notes are not B1's).

## Goal
An app host whose trust model, rules and appearance are catalog data, not constants: ingested sources are data and never instructions (any enforcement tier is an option, off by default), a view-server channel is derived from a security suite record, an app's look is data on a stated graphics baseline, and the harness's query surface and the platform's enumerable result sets are one shape or a recorded mapping. The reviewer app then reads real sessions and concerns from the harness as its daily work.

## Why not a toy
- Trust is tested against real injection-shaped content: tool results and file contents from actual wh sessions that contain text addressed to a model. The platform's rule "ingested text is data, not instruction" is the same rule this very harness's agents operate under, so a failure is visible in practice.
- The look is not a sample: the harness page's own theme and slot rules (`docs/THEME.md`, `docs/RENDER-PLUGINS.md`, ui-style skill) are expressed as look data and round-tripped, so the claim "look as data" has a real page to be wrong about.
- The reviewer app replaces a manual step of this plan: the operator's reading of ledger and diff for each canary (README section 6, step 5).

## Flows and concepts exercised
- Concepts: principal, delegation, ingested source, provenance, ingested distrust, view-server channel, security suite record, regulatory protocol record, look, surface, shader spec on a candidate baseline (PH17, Q11), enumerable result set, trace guard.
- Flows: `ep-B2.1-injection-corpus` (stage-0 sessions reading tool results with embedded instructions, recorded as data-versus-instruction classification), `ep-B2.8-reviewer-on-A1` (the reviewer app reviews A1's canary from records alone).
- Strategies: baseline `strat-stem-1.0` for the stage-0 sessions; the query-surface strategy of A1 for B2.5 once G1 is met.
- Open questions it must answer or put to the person: Q1 (self-improvement-resistant surfaces: which reading), Q5 (trust versus CLAUDE.md's restrictions-are-options), Q6 (external effects), Q7, Q8 (who may change catalog records), Q11 (graphics baseline wording).

## Stories

### B2.1 Trust: ingested distrust on a real corpus
- Owner `platform` for the notes and classification rules; `context` for the corpus runs; stage 0.
- Needs: G0.
- Acceptance: a corpus of at least 30 real tool results and file contents from this repo's wh sessions and docs that contain text addressed to a model or presenting authority (named, not invented); each labelled data-not-instruction by a rule stated as data (provenance, ingested source, principal), not by a keyword list alone; the cheap models are run on the same corpus under the existing harness behaviour as the comparison arm. The classification is an option, never enforcement: nothing is blocked by default.
- Measure: share classified correctly by the rule; share the cheap models acted on as an instruction; false positives. Q1 and Q5 readings put to the person in one question.

### B2.2 Principal, delegation and who may change the catalog
- Owner `platform`.
- Needs: B2.1.
- Acceptance: delegation as a scoped, revocable grant the app acts under for its principal; effects name it; Q8 (who adds or changes catalog records: user, signed vendor, the app) written as options with the cost of each; a paper check against the harness's own catalog rule (agents write inboxes, the steward alone merges) as a worked example of one answer.
- Measure: paper check; the harness rule expressed as a delegation record without loss.

### B2.3 Security suite and regulatory protocol records
- Owner `platform`; `survey` for the standards facts (coarse, budgeted).
- Needs: B1.3 (protocol catalog shape).
- Acceptance: PH7 and PH8 as records; PH10 (channel encryption derived from the suite record with no app code and no user step) written with what could refute it; unverified names marked "unverified" until the survey confirms them.
- Measure: paper check against two real endpoints the harness uses (OpenRouter's API host, GitHub's API); what the record cannot express is a recorded gap.

### B2.4 Look as data and the graphics baseline
- Owner `platform`; `ui` consulted for the page's actual rules and slots; `survey` for Q11.
- Needs: none.
- Acceptance: PH16 expresses the harness page's theme tokens and slot rules as look data and a paper round trip (look data to the same rules) loses nothing the page uses; PH17 and Q11: the baseline wording stays "candidate" unless a primary source for a settled baseline is found; the fallback story for hosts without the baseline is written with its cost.
- Measure: share of the page's theme tokens and slots expressed without a new field; gaps recorded.

### B2.5 Query surface mapping against the real surface
- Owner `platform` (mapping notes), `seams` (the red checks and the adapter if GB and G1 are met).
- Needs: G1 (the query surface merged and released), B1.3 (PH6).
- Acceptance: P-Q1 to P-Q6 in `docs/platform/query-surface.md` resolved against the actual header v1, kinds, refs and reducer hook; where the platform's enumerable result set and the harness's result-set header differ, the difference is listed with cost and one is chosen or a mapping is specified; a conformance check runs the harness's Q1 to Q22 examples through the mapping.
- Measure: share of Q-checks passing through the mapping unchanged.

### B2.6 External effects and knockout (Q6)
- Owner `seams` (after GB), `platform` for the notes.
- Needs: B1.8; B2.2.
- Acceptance: effects declare compensation or are non-voidable; a knockout of a run containing an external effect (a message sent, a payment made, modelled with the mock provider and a fake effect host only) either compensates or refuses with a record; delegation is named on each effect.
- Measure: cases passing in a table of at least 8 effect kinds (including at least two non-voidable).

### B2.7 Surface contract and look rendering
- Owner `seams` for the host side, `ui` for look rendering if it shares code with the page (ui-style).
- Needs: GB, B1.7, B2.4.
- Acceptance outline: a surface contract in the host renders a look record on the stated baseline with a fallback; the reviewer app's views use it; no native dialogs; state-based smoke check.

### B2.8 Reviewer app
- Owner `seams`; `context` measures.
- Needs: B1.9 (ledger app), B2.5 (query mapping), B2.7 (surface).
- Acceptance: the reviewer reads real wh dir records and concerns through the platform (as-of reads and the mapped query surface) and produces what `turn-analysis` produces by hand (shape, sizes, counts, cost, cache, repeats, result classes) for one real session; trust is on as classification (not blocking), and every read has an event record. Flow `ep-B2.8-reviewer-on-A1`: it reviews A1's canary (A1.5) from the records alone, and the operator compares its output with the hand-made descriptive pass.
- Measure: agreement of counts with `scripts/turn-profile.mjs`; time against the manual read; what the operator would have drilled into that the reviewer missed.

### B2.9 Judge, record, release decision
- Owner `judge`, then `steward`.
- Needs: B2.5 to B2.8.
- Acceptance: judge against catalog and specs; findings go back; PH results recorded as supersedes; release by the same rule as B1.10.

## Dependencies and lanes
Order: B2.1, B2.4 (parallel, no shared files) then B2.2, B2.3; B2.5 after G1; B2.6 after B1.8; B2.7; B2.8; B2.9.
Parallel in separate sessions: B2.1 with B2.4; B2.2 with B2.3; B2.5 with B2.6 once their needs are met; B2.7 ui side with B2.6.
Cross-epic: B2.8 depends on A1 (G1), B1.9 and optionally A3.5; B2.1 corpus draws on sessions of all epics.

## Measurement points
1. B2.1 classification accuracy and cheap-model compliance on the corpus.
2. B2.2 the catalog rule as a delegation record without loss.
3. B2.3 fit to two real endpoints.
4. B2.4 share of the page's tokens and slots expressed.
5. B2.5 share of Q-checks through the mapping.
6. B2.6 effect-kind table.
7. B2.8 agreement with the profile script and the manual pass.

## Risks recorded in advance
- The corpus may show that a data-versus-instruction rule is not decidable from provenance alone; then the result is a recorded limit and the enforcement tier stays an option.
- The two result-set shapes may not unify; then a recorded mapping, not a forced merge.
- Q11: if the baseline stays unsettled, PH17 stays on a candidate baseline; B2.7 then renders only the fallback and says so.
