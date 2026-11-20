# Programme: how a concept earns its way in

A concept in `CATALOG.md` is promoted only after it has done real development work in a silo and beaten the current behaviour on numbers we wrote down first. This file is the method. `HYPOTHESES.md` holds the individual experiments.

## Roles

- **Hypothesizer**: a Fable subagent run in Claude Code (not through OpenRouter, not through the harness). It reads the specs and the live evidence and proposes falsifiable hypotheses. It never touches a branch.
- **Operator** (Claude Code, me): picks the order, sets up the silos, reads every approval card before `wh allow`, records results.
- **Worker models**: cheap OpenRouter models only for now (`tencent/hy4-flash`, `qwen/qwen3.7-flash`), driven through the harness.
- **Judge**: the operator reads the diff and the ledger. A model's own report of success is not a result.

## Silo

Each experiment has two arms with the same task, same model, same starting commit.

| | Blue | Green |
| --- | --- | --- |
| Behaviour | the current harness plus the exact brief by hand (C13) | the candidate concept, as its own strategy id (`strat-...-exp-<id>`) |
| Session | its own wh session | its own wh session |
| Branch | `silo/<hyp>-blue` off the same base | `silo/<hyp>-green` off the same base |
| Repo | GlyphHarness/Web, throwaway branches only; or `GlyphHarness/wh-live-sandbox` when the task is not real code | same |
| Writes | approval card read by the operator, then `wh allow` | same |

Nothing in a silo lands on `main`. A silo branch is deleted when its result is recorded, unless the diff itself is the finding.

## Canary, then full

1. **Canary**: one task of the real work, one run per arm, hard cost cap. Stop early if green exceeds 2x blue cost or produces an unreviewable diff.
2. **Full**: only if the canary is not worse; three runs per arm on tasks of different shape (a code edit, a doc edit, a multi-file change) so one lucky task does not decide.
3. **Bring forward**: a concept moves to `promoted` only if it passes its own thresholds, did real work (the diff is one we would merge or did merge), and the cost per operation stayed under one cent for helper operations. A passing concept is then built behind its strategy id; it is not the default until a second experiment on different work agrees.

## What counts as pertinent work

Work already on the board: the PR 15 gaps (tmux session passing, a refused-repo test), issues 5, 8, 9, 11, 12, the vm suite going red on main. No toy tasks, no "write a fizzbuzz".

## Measures written down before running

Each hypothesis states its own thresholds. Common measures:

- completed: the intended change exists and the checks that apply pass
- operations to complete (requests, tool calls)
- hand nudges needed (target 0 for green)
- cost, from the ledger, per arm and per helper operation
- cache hit ratio after the first cached request
- reviewable: operator would merge the diff as is

## Confounds to control

- The same model on the same task varies run to run; the full stage uses three runs and reports spread.
- The brief matters more than any concept; blue arms get the exact brief so green is not credited for what a good brief gives.
- Prompt-cache state differs between the first and later runs; alternate arm order.

## Reporting

Each result is a row in `HYPOTHESES.md`: arm outcomes, costs, verdict (`promote`, `retest`, `drop`), the link to branch or trace, and what the failure or surprise taught. Failures stay in the file.

## Isolation

Added 2026-11-20 after the H1 canary, where both arms shared one sandbox repository and blue listed the branches and read green's (`HYPOTHESES.md`, Results, lesson 6). This is how a run is set up. It is not a restriction in the harness: no allowlist, no gate.

- **A working copy per arm.** Each arm works in its own copy, seeded from the same commit: its own clone directory on the host, or its own throwaway repository. For new experiments this replaces the Silo table's one repository with two branches.
- **Operator state per arm.** Each arm has its own `wh` state directory and daemon (`--dir`, `--port`), so browser profile, sessions and command log are separate.
- **A distinct salt per arm and per run** (the salt line of `HYPOTHESES.md` (b) 2), so no run reads a cache another run wrote.
- **The record says what each arm could see.** Each result names, per arm: the working copy (path, or repository and seed commit), the repositories the token in use lists, the salt, and whether the other arm's copy existed and was reachable while it ran. An arm that could see the other's work is reported as such; its run is not dropped silently.
