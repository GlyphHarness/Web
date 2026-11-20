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
- inventory entry: id, label, kind, domain, metadata{size, mtime, path|uri}, captures[{feature_id, payload_handle}], source, captured_at.
- capture feature: id, applies_to (domain or kind), extracts, how (ast|regex|parser|metadata|iac), cost.
- query shape: id, policy_id, over (domains or labels), asks[{what, returns_fields}], rendered_text (what the model is given).
- check record: id, session, entry_id, read (whole|slice|capture only), range, at_turn, t, source_hash.
- has/has-not view: derived, not stored: per entry {entry_id, held (captures), checked (read kinds), stale (hash differs)}.
- network entry: an inventory entry with domain network and captures such as ranges, rules, allow/deny lists.

## Invariants
1. The inventory and check records are harness data beside the turns; no label or record id is written into turn content.
2. The model is given the query shape and the query results, per strategy; whether it is told the inventory exists is the awareness choice of FLOWS.md invariant 4.
3. A capture never stands in for content that was not read: the view says which (held vs checked).
4. Captures are extracted by code or parsers; a model-made capture is flagged as such.
5. A change to the data is a new record; nothing is rewritten.

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

## Open (QI series; the person's wording where given)
- QI1 Who builds the inventory and when: policy-driven, autonomous, or both; at session start or on demand.
- QI2 Staleness after a write: the source_hash differs; does the view mark stale only, or re-capture.
- QI3 How much capture goes to the model versus stays queryable behind the query shape.
- QI4 Trust in the autonomous route: how its asserted seams are checked.
- QI5 Network sources: which IaC and datapoint formats, and which captures are allowed.

## First order of work (hypotheses; smallest first; none built)
- I1 Capture only: from state "app/*.js not inventoried", an inventory of exports and function names can be built by extraction alone (no model); the transition to "inventoried" occurs for every file. Falsified if any file needs a model to yield its names. Needs: a parser pass, one capture feature.
- I2 Query shape: given the query shape, state "file inventoried, not read", the projected transition is a capture query, not a read; repeated reads (watcher "repeated work" flags) fall. Falsified if flags do not fall with the shape present. Needs: I1, one strategy id, silo canary (PROGRAMME.md).
- I3 Has/has-not from data alone: for any session, which entries were checked and in what way is answerable from check records without reading transcripts. Falsified if an answer needs turn text. Needs: check records logged at repo_read.
- I4 Autonomous seams: the seams the autonomous route asserts for app/ match the list in .claude/agents/seams.md. Falsified if it misses or invents seams beyond a few. Needs: I1, one assertion pass.
- I5 Network: one IaC source yields a network inventory (ranges, rules, allow/deny) by extraction alone, with a query shape. Falsified if a rule needs a model to capture. Needs: one IaC file, one capture feature.
