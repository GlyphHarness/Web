# WebHarness (Glyphharness/web)

Static ES modules in `app/`, no build: a browser agent harness with sessions, stems, handles and checkpoints.
Work on `dev`; every piece of work follows the rigid order below.

## Branches
- `dev`: working branch. Keep it releasable.
- `main`: the released site (GitHub Pages, builds in `b/<commit>/`, `version.json`). Release = merge `dev` into `main`, only after the judge passes.
- A clone made for one branch tracks only that branch, and tools then report other branches as "no remote branch" or "unpushed" after a good push. Once per clone: `git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' && git config push.autoSetupRemote true && git fetch origin`.

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
- `turn-analysis/SKILL.md`: describe how sessions and strategies behaved from turn metadata only (existing; read only).

## Rigid order (every piece of work)
1. Name it (nomenclature) - `context`
2. Concept record (hypothesis) - `context`
3. Spec (failing checks) - `seams`
4. Implement at a seam - `seams` (page work: `ui`)
5. Measure (production-style sessions) - `context`
6. Record result and faults in the catalog - the working agent writes its inbox, `steward` merges
7. Judge - `judge`
8. Release - `steward`

## Commands (repo root)
- Suites: `node scripts/smoke.mjs`, `scripts/smoke-git.mjs`, `scripts/smoke-vm.mjs` (these need the repo served and a browser). Plain node, no browser: `node scripts/test-cpu-shares.mjs`, `test-paste-keys.mjs`, `test-localbridge.mjs`, `test-validators.mjs` (suite `validators`), `test-profile.mjs` (suite `profile`). Operator CLI against the mock provider (served page and a browser): `node scripts/test-wh.mjs`.
- CI: `node scripts/ci.mjs [main git cpu keys local validators profile wh vm]` (runs in `.github/workflows/test.yml`; a failing suite opens one ci-failure concern, a pass closes it).
- Operator: `node scripts/wh.mjs <cmd>` (init, new, say, sayfile, system, paste, step, stem, fold, ls, show, assess, flags, review, watch, cost, raw, held, dump, log, forget; `node scripts/wh.mjs` prints all). Options `--channel chrome`, `--headed`, `--dir`. Every command is appended to `<dir>/log.jsonl` (sizes and hashes, no message text, no key).
- Case study: `node scripts/casestudy.mjs --live --repeat N`.
- Docs: `docs/STEMS.md`, `docs/TABS.md`, `docs/PROTOCOL.md`, `docs/TESTING.md`, `docs/concepts/`.

## Non-negotiables
- Tests use the mock provider only; OpenRouter is blocked in tests.
- Secrets never in files or chat.
- No native dialogs (alert/confirm/prompt); use `modal()`.
- Restrictions (allowlists, deny rules, extra gates) are options, off by default. Do not build or enable them upfront; add one when it is wanted as a feature.
- Limits of the session you happen to run in (a cloud session's repository scope, its network proxy) are not product requirements. Do not mirror them in the harness. The control for GitHub access is the token's own repository list.
- Specs before code; a spec change during implementation is its own commit with a reason.
- Catalog via inbox files only (`.claude/skills/catalog/SKILL.md`): agents write `catalog/inbox/<agent>-<shortid>.jsonl`; the steward alone merges into `catalog/*.jsonl`. Records are append-only, one JSON per line.

## Terse lookups (user directive)
- When asked for a terse readout, keep each tool call input under 80 characters and its output under 200. Hide bulk output and extract only the target, using a hint or a terse enumeration token.
- Do not follow up with extra calls that fan out input or output to get around the cap. Splitting a dump across turns counts as bypassing it.
- If a tool cannot be capped (for example MCP session tools return full records), say so and ask instead of querying.
- The cap applies to Bash. For anything uncappable, delegate: fork or spawn an agent whose prompt is baked and short and whose report is capped (under 200 characters, target only). Its own tool output stays in the fork. The spawn call and the report still show in the parent, so keep both terse.
