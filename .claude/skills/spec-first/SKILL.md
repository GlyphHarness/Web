---
name: spec-first
description: Write acceptance checks from a goal, commit them red, implement at a seam, go green.
---

## When
Any change in behaviour, any production fault, any new strategy, tool, hook or policy. Not for pure docs.

## Steps
1. Write the goal as sentences, one behaviour each. Name what happens, not how.
2. Pick the seam (`.claude/agents/seams.md` list). No seam fits: stop and write an inbox record.
3. Write one acceptance check per sentence in the matching suite: `scripts/smoke.mjs` (main), `scripts/smoke-git.mjs`, `scripts/smoke-vm.mjs`. Assert on state (`whDebug`, localStorage, `data-*`), never on text. Add mock triggers in `app/providers.js` if needed.
4. Serve and run the suite; the new checks must fail, the old ones pass:
   `python3 -m http.server 8787` (repo root, background), then `node scripts/smoke.mjs`.
5. Commit the red state: `git commit -m "Spec: <behaviour> (<why>)"`. Message names the seam.
6. Implement at the seam only. If the model's view changes, register a new strategy major version.
7. Run to green: `node scripts/ci.mjs main git` (add `vm` when `app/vm*`, `app/vmhost.js` or `vm/` changed).
8. Commit the implementation. Never push, merge or release from here.

## Rules
- A check that is wrong (asserts mechanism, wording, or contradicts the goal): fix it in its own commit `Spec: <what was wrong and why>`, before touching the implementation. Never loosen a check inside the implementation commit.
- A goal that changes mid-way: same, its own `Spec:` commit with the reason.
- Production fault: write the check from the fault first, see it red, then fix.
- Tests use the mock provider only; real models run only through `scripts/wh.mjs` sessions.
- A check that cannot fail is not a check; see it red before moving on.

## Records
- Red `Spec:` commit, then the implementation commit, in order in `git log`.
- `ci-record.json` from `scripts/ci.mjs`; a failure opens one `ci-failure` concern.
- Result lines go to `catalog/inbox/seams-<shortid>.jsonl`, never to `catalog/*.jsonl`.
