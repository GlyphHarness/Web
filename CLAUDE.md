# WebHarness (Glyphharness/web)

Static ES modules in `app/`, no build: a browser agent harness with sessions, stems, handles and checkpoints.
Work on `dev`; every piece of work follows the rigid order below.

## Branches
- `dev`: working branch. Keep it releasable.
- `main`: the released site (GitHub Pages, builds in `b/<commit>/`, `version.json`). Release = merge `dev` into `main`, only after the judge passes.

## Agents (`.claude/agents/`)
- `steward.md`: owns the order, delegates, merges catalog inboxes, releases.
- `ui.md`: the page (DOM, styles, slots, cards).
- `seams.md`: seams between modules, spec first (TDD/BDD).
- `context.md`: context features and the concept catalog, per model.
- `judge.md`: reviews against catalog and specs; edits nothing.

## Skills (`.claude/skills/`)
- `ui-style/SKILL.md`: append-only rendering, rules, slots, data-* hooks.
- `spec-first/SKILL.md`: failing checks before code.
- `context-experiments/SKILL.md`: production-style sessions and measurements.
- `catalog/SKILL.md`: nomenclature, concepts, faults; inbox writes.

## Rigid order (every piece of work)
1. Name it (nomenclature) - `context`
2. Concept record (hypothesis) - `context`
3. Spec (failing checks) - `seams`
4. Implement at a seam - `seams` (page work: `ui`)
5. Measure (production-style sessions) - `context`
6. Record result and faults in the catalog - `context` writes its inbox, `steward` merges
7. Judge - `judge`
8. Release - `steward`

## Commands (repo root)
- Suites: `node scripts/smoke.mjs`, `scripts/smoke-git.mjs`, `scripts/smoke-vm.mjs`.
- CI: `node scripts/ci.mjs` (runs in `.github/workflows/test.yml`; a failing suite opens one ci-failure concern, a pass closes it).
- Operator: `node scripts/wh.mjs <cmd>` (init, new, say, step, stem, fold, ls, show, assess, flags, review, watch, cost, raw).
- Case study: `node scripts/casestudy.mjs --live --repeat N`.
- Docs: `docs/STEMS.md`, `docs/TABS.md`, `docs/PROTOCOL.md`, `docs/TESTING.md`.

## Non-negotiables
- Tests use the mock provider only; OpenRouter is blocked in tests.
- Secrets never in files or chat.
- No native dialogs (alert/confirm/prompt); use `modal()`.
- Specs before code; a spec change during implementation is its own commit with a reason.
- Catalog via inbox files only: agents write `catalog/inbox/<agent>-<shortid>.jsonl`; the steward alone merges into `catalog/*.jsonl`. Records are append-only, one JSON per line.
- No model names in commits beyond the session's attribution lines.
