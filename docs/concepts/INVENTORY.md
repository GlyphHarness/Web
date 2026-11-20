# Inventory, captures and the has/has-not view (hypothesis, 2026-11-20)

Status: hypothesis. Rigid order steps 1 (name) and 2 (concept records) only; nothing is built.
1. A development target is partly defined, partly nebulous; resolving it means knowing what can be checked and what has been checked, because content qualifies itself only once looked in.
2. An inventory enumerates blobs by label with metadata and high-level captures (for code: function names, member declarations, signatures); a query shape tells the agent what it can ask.
3. Check records say what was actually read; the agent then starts from an exact has vs has not and moves concern to concern (FLOWS.md concern queue), outside policies driving or enhancing.

Stance as FLOWS.md: state and transition, no person comparison, no rigid baselines.

## Terms (index of record: catalog/nomenclature.jsonl)
- inventory: the enumerated blobs of a target with metadata and captures; harness data beside the turns.
- inventory entry: one blob by label: its kind, data domain, metadata and captures.
- capture: a high-level extract of an entry (signatures, test names, headers); never stands in for content not read.
- capture feature: a catalogued way to capture (AST, regex, parser, metadata, IaC); combinations are themselves catalogued and built upon.
- query shape: the synopsis of what can be queried (e.g. "TypeScript files and their signatures; spreadsheets and their columns").
- data domain: the kind of content an entry holds (code language, spreadsheet, essay, image, network config).
- check record: what a session read of an entry (whole, slice, capture only), and when.
- has/has-not view: derived from entries and check records; per entry, held and checked, or not.
- network inventory: the same idea over IaC or captured datapoints (IPs, subnets, allow and deny lists).
- Two routes: policy-driven (a policy says what to extract and consolidate) and autonomous (built unaided); after the autonomous route what is left is asserting seams and inferring interface points and domain contracts.

## Records (fields only; harness data, stored beside turns)
- inventory entry: id, label, kind, domain, metadata{size, mtime, path|uri, hash (raw content hash), checksum (line-ending-normalized, the identity: QI10)}, captures[{feature_id, payload_handle}], source, captured_at.
- capture feature: id, applies_to (domain or kind), extracts, how (ast|regex|parser|metadata|iac|lsp), cost.
- query shape: id, policy_id, over (domains or labels), asks[{what, returns_fields}], rendered_text (what the model is given).
- check record: id, session, entry_id, read (whole|slice|capture only), range, at_turn, t, source_hash (raw), source_checksum (normalized, QI10).
- has/has-not view: derived, not stored: per entry {entry_id, held (captures), checked (read kinds), stale (hash differs)}. Joined form (QI10), `view(inv, {join: true})`: per checksum {checksum, entry_ids[], labels[], held, checked, stale}; entries whose checksum is equal are one row that lists all their labels (a file path and a git path), held from whichever entry has captures, checked from whichever has check records.
- network entry: an inventory entry with domain network and captures such as ranges, rules, allow/deny lists.

## Invariants
1. The inventory and check records are harness data beside the turns; no label or record id is written into turn content.
2. The model is given the query shape and the query results, per strategy; whether it is told the inventory exists is the awareness choice of FLOWS.md invariant 4.
3. A capture never stands in for content that was not read: the view says which (held vs checked).
4. Captures are extracted by code or parsers; a model-made capture is flagged as such.
5. A change to the data is a new record; nothing is rewritten.
6. Identity is the content checksum, not the label (QI10): joining is done in the derived view, never by rewriting stored entries or labels.

## Relation to what exists (paths verified by grep, 2026-11-20)
- app/explorer.js: lists a session's pinned directories as new/modified/existing against a baseline, files opened on demand. It marks change, not what was read or captured; the inventory extends its listing.
- app/tools.js repo_read: ops file, tree, log, diff, branches, prs. Its tree op is a repo enumeration source; its file op is what a check record would log.
- app/outstore.js and app/handles.js: results stored by handle; captures and read slices fit as handles.
- Watcher: app/main.js flags a call whose result repeats an earlier one ("repeated work: the same result as #n"), after the call. Fault fhjphb/ngdref (redundant output_read, catalog/faults.jsonl): a check record makes it detectable before the read.
- C13 exact brief and its "read a file once" directive (CATALOG.md C13, HYPOTHESES.md H1): the inventory supplies the data the directive relies on.
- C14 turn analysis (.claude/skills/turn-analysis/SKILL.md): reads can be profiled against check records.
- .claude/agents/seams.md: the seam list (tools, providers, strategies, terminal hooks, policies, handles, checkpoints, machine, coordination, UI) is the reference for I4. No inventory seam exists yet.

## How it feeds FLOWS.md
- State snapshot gains what is held and what was checked (the has/has-not view).
- Concern queue entries can point at inventory entries.
- The autonomous route asserts the seam contracts of the FLOWS.md "Seam contracts" section: seams, interface points, domain contracts.
- Handlers see semantic entries; inventory entries and captures are a natural source of them.

## Language intelligence and structural edits
1. A language service (a language server, as in VS Code) exposes symbols, definitions, references and types as a materialized reference, so nothing reads the codebase verbatim; it is an alternative capture source to walking an AST ourselves.
2. The agent selects the seams it wants to edit; tools fetch what it is interested in, and only the pertinent details of where things exist, not verbose content.
3. Edits are structural: AST graphs are altered in place and the code is built from them (codegen), not by editing files directly.
- Terms: language intelligence (the service as capture source; capture feature how: lsp), symbol entry, reference edge, seam selection, structural edit, codegen (as used here: regenerating files from an altered graph).
- symbol entry: name, kind, container, file, range, signature, references_count.
- reference edge: from_symbol, to_symbol, kind (call|import|extends|reads|writes).
- seam selection: session, symbols[] chosen, why (semantic entry ref), at_turn.
- structural edit: target (symbol or node path), operation (insert|replace|remove|rename|wrap), payload, preconditions[].
- codegen result: files_regenerated[], diff_handle, checks_run[{name, outcome}].
- Invariants. (a) A structural edit names a node, never a text position found by searching. (b) Codegen output is a normal diff and goes through the same approval and specs as any commit. (c) The symbol view is a capture: the has/has-not rule applies (a symbol entry is not a read of the body).
- Relations. Today's edit path is `repo_commit` with `edits` [{find, replace}] (app/tools.js CHANGE and repo_commit; app/git.js ~lines 110-130): each find must occur exactly once in the file at the branch head, else it throws "find occurs N times (must be once)". The measure "first-try edit success" and H1 are in docs/concepts/HYPOTHESES.md; find strings copied wrongly are the failure a structural edit removes. The seams list in .claude/agents/seams.md is the first target for seam selection. The semantic-entry handler of FLOWS.md picks entries; symbol entries are such entries. No language service or codegen exists in app/ today.

## Questions and answers (QI series; source: person = verbatim direction, recommended = the orchestrator's recommendation, asked for by the person)
- QI1 Who builds and when (recommended). Both routes. Extraction with no model at session start for pinned folders and repos in scope; on demand for the rest; policy decides which capture features run. Open: none beyond QI6.
- QI2 Staleness (recommended). A differing source hash marks the entry stale; it is re-captured on the next query. A check record keeps the hash it saw, so "checked" is always "checked at this hash". Open: none.
- QI3 How much the model sees (recommended). The query shape and counts only; captures come back through queries; nothing is preloaded. Open: none.
- QI4 Trust in asserted seams (recommended). An asserted seam is a hypothesis until a spec check exercises it (.claude/skills/spec-first/SKILL.md); a mismatch with .claude/agents/seams.md becomes a concern queue entry. Open: none.
- QI5 Network sources (person). IaC and captured datapoints (addresses, subnets, allow/deny lists that a network already has), each format as a provider. Person: repo allowlists are not a source and not something to build or switch on upfront: an option at most; building restrictions before they are wanted is an over-engineering smell (mitigation is still fine where it is wanted). The harness's existing profile repo lists stay as they are: optional, empty by default (app/profiles.js). Nothing from the hosting environment of a particular session (its outbound proxy, its allowed hosts) is a source: that describes where one agent happens to run, not the project.
- QI6 Engine and where (person + recommended). Person: "In a pluggable solution, anything can run from anywhere." No fixed engine or place. A capture provider is anything meeting the seam contract below. Person: providers are whatever open source (or other) engine is relevant; not all languages, only what is needed: JS and Python for now, the rest as we go. The principle and what the callee receives are the same whatever the engine. Recommended engines to start: the TypeScript language service for JS; for Python, its own `ast` module for captures and an open-source language server (Pyright or Jedi) for references. Person: records are captured and provided to the logs, in the GitHub repos set in the config of the harness or dashboard (the log repo). Recommended: a provider does not register with the page; it writes records in the agreed shape, with its provider id, to the configured repo, and the harness reads them. Nothing open.
- QI7 Comments (person + recommended). Person: comments can be associated with the concerns in the graph, outside files, no need to bloat the files. Comments live as annotations on nodes and concerns; on ingestion existing comments are lifted; codegen emits none, except functional comments (invariant d). Person: assume agents infer from generated files; people reading them is not a concern. If it ever matters, a model can take everything and explain it for the person; that is not built and not planned. Nothing open.
- QI8 Languages (person + recommended). Each language has its own AST or node graph; one provider per language. Only the cross-language records are neutral: symbol entry, reference edge, node path, structural edit, annotation. No common AST. Open: none.
- QI9 Approval (recommended). Show the operation (node path, operation, payload) above the generated diff; approval stays on the diff, through the existing approval card. Open: none.
- QI10 One file, two labels (person; closes the label question left open in the I1 result row of HYPOTHESES.md). The build labels a file by its file path (`app/x.js`) and a read through `repo_read` labels it by its git path (`owner/name:path`), so what is held and what was checked for one file sat in two rows. Person's direction, verbatim: "can use the file/git blob path, keep both, checksum the file, its fine, they are the same thing, the checksum will indicate that." And on the normalization: "conventional cross-os format of file comparisons being normalized so we dont have mismatches on identical files (aside from endings)". Resolved as follows.
  - Both labels are kept as they are; no label is rewritten and no convention is chosen. Identity is the file's checksum: entries whose checksum is equal are the same thing, and the joined has/has-not view shows them as one row that lists every label.
  - The checksum is `contentHash` (app/handles.js) over the text with CRLF turned into LF, the way git normalizes text. A lone CR, a BOM and trailing white space are not touched (they are real differences). A file git would treat as binary, a NUL byte in its first 8,000 bytes, is hashed raw. It is computed by one function, `checksum(text)` in app/inventory.js, used by the build (`metadata.checksum`) and by the repo_read check record (`source_checksum`; the entry made by the read gets `metadata.checksum` the same way). The raw `hash` and `source_hash` keep their meaning (append only: no existing field changes) and still decide the per-entry stale flag.
  - Join key: the entry's current `metadata.checksum` (an entry made before this field exists falls back to its `hash`). held is the union of the joined entries' capture features, checked the union of the read kinds in their check records (one session when given), entry_ids and labels list every joined entry in the order first seen.
  - Stale in the joined row: some joined entry's last check saw another checksum than the entry holds (the QI2 rule, on checksums, so CRLF against LF is never stale).
  - A change un-joins. When a file changes, its rebuilt entry has a new checksum, which no longer equals the other label's entry: the rows part, the changed label is held and not checked (checked is "at this checksum", QI2), the other label keeps what was checked at the old content. A repo_read entry keeps the checksum it was first made with (I3: a read of a changed source adds a check record, not a new entry), so after the file changed and was read again that label's row is stale and stays apart from the rebuilt file path; it is not re-joined by a later read. Known limit, not worked around: it needs the read to start a new entry record when the checksum moves, which changes the I3 contract.
  - Known limit: different files with identical content (two empty files, two copies of a template) have the same checksum and join into one row. The row keeps every label, so nothing is hidden; no path heuristics are added to tell them apart.
  - Known limit: `contentHash` is a short non-cryptographic hash (about 50 bits), enough for a project's files and not an integrity guarantee; a stronger digest is a later change of the one function.

## Capture provider and annotations
- node path: the address of a node in a language's own graph (container chain plus node kind and name).
- annotation: id, target (node path or concern id), text, kind (note|doc|functional), source (lifted|written), t.
- capture provider seam: params {language, scope (paths or labels), op (capture|edit|generate), edit (structural edit, for edit)}; returns {symbol entries[], reference edges[], annotations[]} for capture, {applied (node paths), preconditions_met} for edit, a codegen result for generate.
- Invariant d: functional comments (license headers, shebangs, tool directives such as // @ts-check or lint disables) survive codegen verbatim, because removing them changes behaviour or legal standing; all other comments are annotations outside the files.

## First order of work (hypotheses; smallest first; none built)
- I1 Capture only: from state "app/*.js not inventoried", an inventory of exports and function names can be built by extraction alone (no model); the transition to "inventoried" occurs for every file. Falsified if any file needs a model to yield its names. Needs: a parser pass, one capture feature.
- I2 Query shape: given the query shape, state "file inventoried, not read", the projected transition is a capture query, not a read; repeated reads (watcher "repeated work" flags) fall. Falsified if flags do not fall with the shape present. Needs: I1, one strategy id, silo canary (PROGRAMME.md).
- I3 Has/has-not from data alone: for any session, which entries were checked and in what way is answerable from check records without reading transcripts. Falsified if an answer needs turn text. Needs: check records logged at repo_read.
- I4 Autonomous seams: the seams the autonomous route asserts for app/ match the list in .claude/agents/seams.md. Falsified if it misses or invents seams beyond a few. Needs: I1, one assertion pass.
- I5 Network: one IaC source yields a network inventory (ranges, rules, allow/deny) by extraction alone, with a query shape. Falsified if a rule needs a model to capture. Needs: one IaC file, one capture feature.
- I6 Language service: from state "app/*.js not inventoried", a language service yields symbol entries and reference edges for every file with no file read by a model; the transition to "inventoried" occurs. Falsified if any symbol or edge needs a model read. Needs: one service, I1's check records.
- I7 Structural edit: from state "symbol selected", a rename or signature change expressed as a structural edit regenerates files whose diff is exactly the intended change, with the suites green. Falsified if the diff has any unintended hunk or a suite fails. Needs: I6, a codegen path, a mock-provider session.
- I8 Select then fetch: given symbol entries in the query shape, state "seam selected", the projected edit lands at the right seam and first-try edit success is recorded as data per strategy and model, not a contest. Falsified if the recorded rate does not move. Needs: I6, I7, one strategy id, silo canary (PROGRAMME.md).
- I9 Annotations: lifting the comments of one app/*.js file into annotations and regenerating it leaves the suites green and the file's behaviour unchanged, with functional comments intact. Falsified if a suite fails, behaviour differs, or a functional comment is lost. Needs: I6, I7, one provider, one file.
