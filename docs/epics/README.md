# Epics: building the next stage with the harnesses

Status: plan, 2026-11-21. Nothing here is built. Branch `epics`, from `dev` 2c6b717.
This is a planning layer over `CLAUDE.md` (rigid order, non-negotiables) and `docs/TENETS.md`. It changes no rule. Where this file and `CLAUDE.md` differ, `CLAUDE.md` wins.

## 1. What an epic is here

An epic is a long arc of 6 to 12 stories toward one capability that matters to the work itself, not a demo. Each story is one pass through the rigid order (name, concept, spec, implement, measure, record, judge, release), sized for one or a few sessions.
The test for "not a toy": the epic's inputs are this repo's own real artefacts (ledgers, profiles, catalog, concern queue, sessions of the other epics), its measures are thresholds fixed before the run, and a failed measure is a recorded result, not a rerun until green.

| epic | doc | project |
|---|---|---|
| A1 Read path | `A1-read-path.md` | WebHarness: query surface and text striping integrated, new strategy |
| A2 Claude route | `A2-claude-route.md` | WebHarness: gateway, Claude Code in WSL as the stage 2 driver |
| A3 Flow loop | `A3-flow-loop.md` | WebHarness: flows, router, validators, concern queue; steering vs structure |
| B1 Platform spine | `B1-platform-spine.md` | App platform (the only project `docs/platform/` and `.claude/agents/platform.md` name): contracts, protocols, time; first app "ledger" over real harness records |
| B2 Platform edges | `B2-platform-edges.md` | App platform: trust, query mapping, look; second app "reviewer" |

B has one project, the app platform concept (`docs/platform/README.md`, Q2 and Q3 there are still open: embedder runtime vs browser layer, separate product vs way to express harness seams). The B epics do not settle them by decree; B1.1 turns them into measured choices.

## 2. The stage ladder (which harness drives which stage)

The driver is the harness that runs the story's working sessions. The record steps (name, concept, spec, judge, merge) stay with the registered agents of `CLAUDE.md`; a driver never replaces an owner.

| stage | driver | opens when | drives |
|---|---|---|---|
| 0 | WebHarness at `main` (v0.56.0) on cheap non-Anthropic OpenRouter models (the PROGRAMME worker set: `tencent/hy4-flash`, `qwen/qwen3.7-flash`), started and read with `node scripts/wh.mjs` (held or stepped), strategy `strat-stem-1.0` | now | planning and research stories: survey passes, fixture corpora, drafts of specs and docs, comparison write-ups, read-only audits of ledgers. Output is a draft in a silo copy; the owning agent takes it through the order |
| 1 | the same harness with the query surface and striping integrated, behind a new strategy major (OQ11 in `docs/QUERY.md`) | A1 gate G1 (below) | the same shapes of story, with large-result reading through `query`/`query_ref` and striped skeletons; first real A/B of the read path on the epics' own data |
| 2 | Claude Code in WSL (UbuntuBase, tmux session `claude`), signed in by the user, requests through the gateway; auth blind | A2 gate G2 (below) | heavier stories: code across several seams, long multi-file specs, judge-grade reviews. Subscription use only through Claude Code itself |

Fixed rules for the ladder:
- Stage 0 never waits on stage 1 or 2; it carries the first weeks.
- A story is assigned to the lowest stage that can do it; promotion to a higher stage needs a recorded reason (stage-0 result too weak, with the evidence), not preference.
- No API key from us is ever used for Anthropic models; no Anthropic model is used on OpenRouter. Worker models are the cheap non-Anthropic set. Subscription capacity is touched only by the user's own signed-in Claude Code binary. The gateway copies headers blind (R18, R3 in the survey).
- A stage-1 or stage-2 arm is a comparison arm against stage 0 on the same story shape, not only a tool. The first stories run at each stage record a baseline so the ladder itself is measured.

## 3. Gates

A gate is a recorded check, not a date. A gate is met when its records exist; an unmet gate blocks only the stories that name it.

| gate | needs | blocks |
|---|---|---|
| G0 | `node scripts/ci.mjs` green on `dev`; `node scripts/test-wh.mjs` green (mock provider); a wh dir for the epics with its own port and salt (PROGRAMME isolation) | every stage-0 session |
| G1 | judge pass on `query-surface` (Q1..Q22 green) and on `stripe-surface`; both merged to `dev`; A1.2 integration spec green; new strategy id registered (never an edit of `strat-stem-1.0`); canary of A1.5 shows no regression on a cheap-model task; release to `main` with `version.json` bumped | stage 1; A1 stories from A1.6; B2 query-mapping check against the real surface |
| G2 | judge pass on `claude-route` (gateway G0..G11, listener split, canary scan); user signs in to Claude Code in WSL (a user step, never ours); live checks recorded: cache hit R13 within 2 points of direct, halt-and-alter accepted without a retry R14 (with no double retry R12), thinking behaviour R6a measured and R17 confirmed (drop or edit of a thinking block breaks the signature); R15 (cache_control normalisation) only if policy mode is switched on | stage 2; A2.7 onward; every stage-2 story |
| GB | the person says build for the platform concept (`docs/platform/README.md`: "everything is hypothesis until the operator says build"), with the Q2 and Q3 answers and where the code lives, recorded | B1.6 onward, B2.5 onward (query mapping also needs G1), B2.6 onward; notes stories B1.1 to B1.5 and B2.1 to B2.4 need only G0 |
| GJ | judge pass on the story's change set before any merge to `dev` beyond specs; release is `steward` after GJ and green suites | every merge to `main` |

Label note. The brief for this plan called the live checks "R-cache", "R14" and "R15 thinking policy". In `docs/platform/claude-route-survey.md` (branch `claude-route`) the numbers are: cache hit R13; halt-and-alter acceptance R14 and no double retry R12; thinking volume R6 and signature breakage R17; cache_control normalisation R15. Gates here use the survey's numbers. The step-one hypotheses in the survey's plan are R1-R5, R11-R13, R16, R18; R6-R8, R14, R15, R17 are "next". So G2 demands R14, R6a and R17 earlier than the survey's own order; A2.5 and A2.6 pull them forward. If the label mapping above is wrong, only this note changes.

## 4. How issues become concern records

1. A failed check, a measure past its threshold the wrong way, an unexpected flow behaviour (QF1: "more issues than anticipated"), or a model fault is first written to the working agent's own inbox as a fault line (`to: faults`) when it is a model or tool-call fault, or as a concern when it needs work.
2. A concern is a GitHub issue labelled `concern` and `kind:<kind>` (template `.github/ISSUE_TEMPLATE/concern.yml`: pattern, interop, protocol, policy or steering, cost, ui, other). Filed by `concern_file` (the person approves) or the issue form. A failing CI suite opens one `ci-failure` concern by itself and closes it on pass.
3. Epic convention for the issue body, no new fields: the `Where` field starts with `epic A1.3` (story id), then session id or file. The title starts `[concern] A1.3 ...`. `What happened` quotes the evidence (call, ledger row, trace excerpt), never a claim (TENET 5).
4. Resolution order: a concern that names a missing check becomes a spec change first (its own commit with a reason, `CLAUDE.md`); a concern about behaviour goes through steps 3-4 of the rigid order; a concern about a strategy becomes a new strategy id (never an edit); a model-specific misbehaviour becomes a fault record with `class` common, uncommon or provider.
5. The queue is drained by the A3 handler in two modes, strapped (a flow of turns) and natural (the person's or agent's steering), once A3 has them. Before that, drained by hand: `steward` reads the open concerns each Monday and routes each to an agent by kind (cost and policy to `context`, ui to `ui`, protocol and interop to `seams`).

Pitched flows, dithering and natural steering versus structured flows: the user's own pitched flows are treated as hypotheses (QF1). The person pitches a flow (or a steering habit) with a hypothesis; it may be dry-run against existing conventions; if it shows more issues than anticipated, the protocol is swapped and the session continues (FLOWS.md QF1). Natural steering is never banned from a story: both modes are arms (F9), recorded with token weight and unaddressed concerns, no winner assumed.

## 5. How flows are named and recorded

- A flow pitched for a story is named `ep-<story>-<slug>` (example `ep-A1.5-serial-vs-query`), lower case, no spaces. The name appears in three places only: the story's block in the epic doc, the session's tag sidecar (flow tag plus premise; checkable from the sidecar alone, FLOWS.md invariant 1), and the concern or result record that cites it.
- A flow is recorded as a hypothesis first (what it expects, what refutes it), with the strategy id it ran under, the model, the wh dir and the arm (steering mode: natural, strapped, dithered). A change to what the model sees is a new strategy id: `strat-<name>-<major>.<minor>`, never an edit.
- The terms (flow, tag, snap policy, turn template, stack, dithering, validator, projection) are the catalog's; this plan adds only the three merged from the steward inbox (epic, driver stage, epic gate; see section 9).
- QF1..QF8 in `docs/concepts/FLOWS.md` stay open questions; A3 turns QF2, QF3, QF5, QF7 and QF8 into measured choices, one story each. Their answers are recorded as concept results with `supersedes`, not as edits.

## 6. The measure and record loop (every story)

1. State the claim, the check that could refute it, the seam it composes at and the dependencies it ties together, in the story block, before work.
2. Fix the thresholds before the run (PROGRAMME: pre-registered, three runs per arm, three task shapes, canary then full). A threshold changed after seeing data is recorded as a changed threshold with its reason.
3. Run production-style sessions with `node scripts/wh.mjs`, as a person drives them: no challenge prompts, no toy tasks. Each arm is its own copy, its own wh dir and port, a distinct salt; record what each arm could see. `log.jsonl` holds sizes and hashes, no message text and no key.
4. Describe before judging: `turn-analysis` reads turn metadata only (shape, sizes, counts, cost, cache, repeats, result classes), then drills into turns the numbers point at.
5. The operator judges from diff and ledger, not from the model's account (TENET 5, 39).
6. Record: concept record with a per-model result and evidence path (`catalog/inbox/<agent>-<id>.jsonl`, `to: concepts`), fault lines for model faults, and a concern for anything needing work. Measured does not mean good: a refuted hypothesis is recorded as refuted, with the evidence kept.
7. `steward` merges inboxes into `catalog/*.jsonl` and deletes each merged inbox file. No agent writes the catalog directly.

## 7. Cost rules (proposals; the person confirms)

None of these exist as code or setting; they are proposed defaults, each an option, off unless adopted (CLAUDE.md: restrictions are options).
- Stage 0 and 1 use only the cheap worker models. Canary arm: one run per arm, a ceiling of about 1.00 USD per canary and 5.00 USD per full silo experiment (3 runs per arm); stop and record if a run passes twice its canary cost with no progress.
- Per-session stop: the harness's own branch budget (default 150,000 tokens, 8 tool rounds; TENET 14) stays; a stage-0 research session that does not converge within two held steps after the budget is closed with a fold (TENET 15) and a concern, not extended.
- Stage 2 has no per-token cost from us (subscription capacity is the user's), but it has a rate and attention cost: at most one stage-2 session at a time per user sign-in; each stage-2 story names why stage 0/1 could not do it.
- Every request has a ledger row (TENET 4); the cost of each story is the sum of its wh dir ledgers and is recorded in the story's result.
- Nothing is run live against OpenRouter in tests. Tests use the mock provider only.

## 8. What is blocked on what, right now (2026-11-21)

Stated as found; some items are the people's or other sessions' state, not decisions here.
- Judges pending. `query-surface` (ffaea7e) and `claude-route` (8193fe1) are implemented on their branches and unmerged; no judge pass is recorded for either. `stripe-surface` (85ccc5c) is implemented and unintegrated, with no measured live benefit and an overhead above its bar (its own notes). So G1 and G2 are both unmet, and stage 1 and stage 2 do not exist yet.
- The intake session's 11 commits sit on local `dev` unpushed (`origin/dev` and `origin/main` are both at 6474015; local `dev` is 11 ahead). Pushing `epics` publishes them as its ancestry; that is a side effect to be aware of, not a release. `main` is untouched.
- The four feature branches all descend from local `dev` 2c6b717 and carry unmerged commits (`git rev-list dev..origin/<branch>`: stripe-surface 22, query-surface 20, claude-route 8, platform-query-notes 2). Each must be merged to `dev` before its integration story, and merge order matters (query-surface and stripe-surface meet at the reducer hook, OQ15).
- Claude Code sign-in in WSL is a user step. Until done and the live checks R13, R14 (R12), R6a, R17 are recorded, A2 stories 2.7+ and all stage-2 stories wait. The gateway core exists and is green offline; nothing in it has met a real Claude Code request.
- The platform concept has no build go-ahead (GB). Q2 and Q3 are open. Until the person answers, B1 and B2 stop at their notes stories, which is a stated acceptable outcome.
- `platform-query-notes` is notes only (P-Q1..P-Q6 mapping to the query surface); it has no code, so B2's query-mapping check needs G1.
- Open questions that change plans (not decided here): platform Q2 (runtime vs browser layer), Q3 (relation to harness), Q10 (where explored records live), claude-route's open-question list, QUERY.md OQ1..OQ16 measures not yet run, FLOWS QF1..QF8.
- Stage-0 weakness is unmeasured. No record says how far the cheap models carry planning and research stories through the harness; A1.1 and A3.1 produce that first measure, and the plan below assumes the answer is "far enough for drafts, not for judgement".
- The cost figures in section 7 are proposals, not measured budgets.

## 9. Catalog entries from this plan

The steward inbox merged into `catalog/*.jsonl` (ids in this plan) holds: nomenclature for epic, driver stage and epic gate ("gate" alone is already a catalog term, so this plan says epic gate); eight concept records (hypotheses) for the ladder and the central claims of A1, A2, A3, B1 (two) and B2 (two); and two fault lines (tool-call gotchas, class common). The steward merges it after review; it is not merged by this commit.

## 10. First week (week of Monday 2026-11-23)

Rules: one owner per file; a story starts only when its needs are met; steps run in the rigid order, so a code story starts with name and concept records. Stage 0 drives the research stories.

| day | story | agent | stage | start condition |
|---|---|---|---|---|
| Mon | judge `query-surface` against QUERY.md Q1..Q22 and the catalog (G1 part) | judge | n/a | none; reads `origin/query-surface` |
| Mon | judge `claude-route` against its survey, gateway checks and the design constraint (G2 part) | judge | n/a | none; reads `origin/claude-route` |
| Mon | judge `stripe-surface` against STRIPE.md (G1 part) | judge | n/a | none |
| Mon | steward: push `dev` and merge the epics inbox after review; `scripts/ci.mjs` green on `dev` (G0) | steward | n/a | the person's go-ahead for the push of `dev` |
| Mon-Tue | A1.1 name and concept records for the integration; corpus of real large results from this repo's ledgers and profiles | context | 0 | G0 |
| Mon-Wed | A3.1 validators on a second skill; stage-0 baseline of what the cheap models carry | context | 0 | G0; F1 is built (`test-validators.mjs`) |
| Tue-Wed | B1.1 resolve platform Q2 and Q3 as written hypotheses with measures; B1.2 contracts data shapes on real harness records | platform | 0 | none (notes only) |
| Tue-Thu | A2.1 name and concept records for the stage-2 gates; A2.2 WSL setup doc check (the doc and script, nothing run) | context, seams | 0 | none; A2.2 reads the branch only |
| Wed | A1.2 integration spec (red) at the provider-to-tools seam | seams | 0 | judge pass on query-surface; else wait |
| Thu-Fri | survey of the three open Anthropic-route questions that are doc facts (not live checks) for A2.3 | survey | 0 | none |
| Fri | week review: steward reads the stage-0 baseline, files concerns, updates this doc's section 8 | steward | n/a | the week's records |

Not started in week 1, by design: any ui story (the card and the route status wait for A1.2 and A2.4), any stage-1 or stage-2 session, B2 (B2.1 and B2.4 are notes stories that need only G0 and follow in week 2 once the platform agent has B1.1 and B1.2 recorded), any release, any platform build (GB unmet).

Stories A1.1, A3.1, B1.1/B1.2 and A2.1 run in parallel in separate sessions: they write different files and different inboxes (`context`, `platform`, `seams` each write only their own inbox).
