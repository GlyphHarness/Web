# Concept catalog (2026-11-19)

Every concept the project is trying, in one place, with where it is specified, what it is meant to replace, and what has been learned. A concept is only promoted when a silo test on real development work (`PROGRAMME.md`) shows it working; the catalog records that, and what failed.

Status: `idea` (said, not written), `spec` (written, not built), `built`, `tested` (a silo result exists), `promoted` (default on), `dropped`.

| Id | Concept | Where specified | Replaces | Status | Result so far |
| --- | --- | --- | --- | --- | --- |
| C1 | **Policy directives**: steering comes from the strategy (a system-prompt base and hooked turn wrappers), versioned with the strategy id; a hand-typed nudge is a missing directive | STEMS.md §5c (PR 14) | operator nudges typed mid-run | spec | live: cheap models needed 2 to 3 hand nudges per task (see C13) |
| C2 | **Probe turns**: at the end of a group of turns, send the context plus a marker, ask for one word, discard the reply; the product is a cache entry at a chosen boundary | STEMS.md §5c | waiting for the provider's automatic cache | spec | live: qwen3.7-flash had no cache hits on its first six requests |
| C3 | **Ambiguous markers** `[label, tag, tag]` in the cached prefix; resolvers give them meaning later, after the prefix | STEMS.md §5c | a concrete steer baked into cached bytes | spec | none |
| C4 | **Ephemeral nudge turn**: a judged payload of past turns plus an instruction that names the action; the model commits to one line; dropped after a few light turns; the commitment stays behind a tagged checkpoint | STEMS.md §5d | repeated manual reminders | spec | none |
| C5 | **Graft**: a small model builds the payload from data, not content (under 10k tokens); a frontier model operates on it | STEMS.md §5d | the frontier model reading bulk | spec | none |
| C6 | **One cent per operation**: enforced by `max_tokens`, payload budget, a ledger row per op, a smell over the cap | STEMS.md §5d | unmetered helper work | spec | live reference: a 17k-token Sonnet request cost 3.5 cents (cache write) |
| C7 | **Recraft pass**: a helper rewrites one wordy reasoning block, dropping loops, never renaming a name; raw stays in the log behind a handle | RECRAFT.md §1 (PR 16) | carrying a model's dithering into later turns | spec | live: hy4-flash spent 18k output tokens circling on one small task |
| C8 | **Voice catalog**: named voices with structure, before/after and degree of coherence; chosen by strategy policy | RECRAFT.md §2 | one implicit style | spec | seed in `docs/recraft/voice-skill.md` |
| C9 | **Term annotation**: crafted / proper / label / regular; a deterministic first pass, a zero-shot second pass that only proposes | RECRAFT.md §3 | renaming of names by a helper | spec | none |
| C10 | **Skill blob**: one per-instance markdown file read by helper workers as a cached prefix; they carry no context between items | RECRAFT.md §4 | per-item context carried by workers | spec | none |
| C11 | **Silo testing**: a concept runs as a candidate (green) against the current behaviour (blue) in its own strategy id and throwaway branch, canary first, on real development work | `PROGRAMME.md` | adopting a concept because it sounds right | idea → this PR | none |
| C12 | **Hypothesizer**: a Fable subagent (run in Claude Code, not through the API) proposes falsifiable hypotheses against the concepts and open work | `PROGRAMME.md` | picking experiments by hand | idea → this PR | `HYPOTHESES.md` |
| C13 | **Exact brief** (the manual baseline): name the files and lines, copy find strings from what was just read, one file per commit, stop at the approval card | this session (issue 1) | nothing; it is the blue arm everything is measured against | built (by hand) | hy4-flash finished with it after 2 nudges; qwen3.7-flash failed three times without it |

| C14 | **Turn analysis**: metadata-only profile of every session's turns (shape, sizes, cost by request slice, cache curve, result classes, repeats), with a drill by index into content only where a number points; descriptive, never a verdict | `.claude/skills/turn-analysis/SKILL.md`, `scripts/turn-profile.mjs` (PR 13) | reading sessions by hand | built | first profile in `OBSERVATIONS.md` (6 sessions) |
| C15 | **Theme tokens**: dark, light and system modes as named CSS custom properties, overridable by developers | session `ui-theme` (`docs/THEME.md`) | hard-coded colours | idea, parallel session | none |
| C16 | **Metrics panel with slot layout**: cost, tokens, cache, calls, checkpoints as widgets the user places in named slots; developers register widgets | session `ui-metrics` (`docs/METRICS-PANEL.md`), reuses C14's profile code | numbers only in `wh` CLI output | idea, parallel session | none |
| C17 | **Render plugins**: per-part templates and an ordered text-transform pipeline, sanitized inline markup, JSON template specs, so turn appearance is open to developers | session `ui-templates` (`docs/RENDER-PLUGINS.md`) | one fixed rendering | idea, parallel session | none |

## Observations that motivated them (live, not hypothetical)

- `tencent/hy4-flash`: repeats `output_read` calls with identical results; needs "stop reading, write now". Cost about $0.01 for the whole issue-1 change.
- `qwen/qwen3.7-flash`: edit find-strings that do not occur exactly once; three failed commits.
- Sonnet 5.5 planned well but cost $0.18 before any commit; the operator asked for cheap models for now.
- qwen3.7-flash first six requests: no cache hits (4k to 8k uncached input each); hits from request 7.

## Rules

- A concept's row changes only with a link to its result (a branch, a trace, a ledger table).
- A failed concept stays in the table as `dropped`, with what the failure taught.
