# Query surface

Status: implemented, unintegrated (2026-11-21). The surface is built in `app/query*.js` (not wired into the page, tools or any strategy); `scripts/test-query.mjs` holds the Q1..Q22 checks, 177 green. Measured in part: `docs/concepts/results/query-det-2026-11-21.md` (deterministic runs) and `docs/concepts/results/query-probe-2026-11-21.md` (a 30-request smoke probe, scripted loop, not a production-style session). The header share target (under 25% of result tokens) is missed at 43.6%; the OQ1 target (parse/validate failures under 15% by the third query) is missed in the smoke probe. The rest of section 8 is unmeasured.

Claim: the harness holds data (session flows, turns, stems, handles, checkpoints, ledger and trail rows, catalog records). One small query language fetches any of it. Every result opens with a header that says what the result is made of and which follow-up actions it passes along. The model acts only on what the header declared. Policy decides how much comes back.

Related, not replaced: handles (`app/handles.js`, opaque ids with per-reader views), `output_read` and `entry_read` (`app/tools.js`), query shape as the synopsis and select then fetch (`docs/concepts/INVENTORY.md` I-hypotheses), enumerable result set (`docs/platform/protocols.md` PH6), progressive exposure and entry_read (`docs/TENETS.md` 21, 38). The query surface is a sibling of these, not a rewrite: v1 coexists with `output_read` and `entry_read`.

Terms (catalog nomenclature, `catalog/inbox/context-bbpyva.jsonl` until merged): query surface, result-set header, query decorator, kind, label, query-ref, declared interaction, staged intent, reducer hook, materialized kind, data-source adapter, query scope. Sibling piece not defined here: text striping (another agent); here only the hook where its reducers plug in (section 5).

Standalone first: a pure ES module, no DOM, no storage, no network, no clock except an injected one. Page integration (tool calls in `app/tools.js`, a card) is a later piece (section 9).

Wire summary. Two model-facing tool calls, later: `query({q, variables?})` returns `{header, data, errors?}`; `query_ref({ref, op, name?, value?, why?})` returns `{header, data, errors?}`. Module API now: `createSurface({adapters, policy, reducers, now, reader})`, then `await surface.run(text, {variables, operationName})` and `await surface.ref(ref, {op, name, value, why})`, `surface.audit()`, `surface.tick()`, `surface.synopsis()`.

## 1. The GraphQL subset

Hand-written lexer and recursive-descent parser. No dependency (decision OQ12).

### 1.1 Grammar (in)

```
Document       := Definition+
Definition     := Operation | Fragment
Operation      := 'query' Name? VarDefs? Directives? SelectionSet | SelectionSet
VarDefs        := '(' VarDef+ ')'
VarDef         := '$' Name ':' Type ('=' Value)?
Type           := Name '!'? | '[' Type ']' '!'?
SelectionSet   := '{' Selection+ '}'
Selection      := Field | FragmentSpread
Field          := (Name ':')? Name Args? Directives? SelectionSet?
Args           := '(' (Name ':' Value)+ ')'
FragmentSpread := '...' Name Directives?
Fragment       := 'fragment' Name 'on' Name Directives? SelectionSet
Directives     := ('@' Name Args?)+
Value          := '$'Name | Int | Float | String | 'true' | 'false' | 'null' | Enum | '[' Value* ']' | '{' (Name ':' Value)* '}'
```

Lexical: commas and whitespace are insignificant; `#` starts a comment to end of line; names are `[_A-Za-z][_0-9A-Za-z]*`; strings are `"..."` with escapes `\" \\ \n \t \uXXXX`; Int is a signed 32-bit integer; an Enum is a bare name that is not `true`, `false` or `null`. Scalars: `Int Float String Boolean ID`. A document has at most one operation (decision OQ1). `__typename` is accepted on any selection set.

### 1.2 Out (each is a PARSE or VALIDATE error, never silently ignored)

- `mutation`, `subscription` (PARSE, `unsupported: mutation`). Writes go through `query-ref` set only, so every write is declared (section 4).
- Inline fragments (`... on T {}`, `... @dir {}`), interfaces, unions, `extend`, SDL definitions (PARSE).
- Block strings `"""` (PARSE). Custom scalars (VALIDATE).
- Directives on variable definitions; directive definitions (PARSE).
- Introspection `__schema`, `__type` (VALIDATE UNKNOWN_FIELD). Replaced by the root field `__synopsis` (section 6.4).
- More than one operation in a document (VALIDATE `MULTIPLE_OPERATIONS`).

Aliases, variables with defaults and named fragments are in. A fragment must name the exact type it spreads into (`on FlowTurn`); no type conditions beyond equality.

### 1.3 Stages

1. **parse**: text to AST. Fails with PARSE, carrying `locations`. Nothing else runs.
2. **validate**: AST plus variables against the merged adapter schema. Collects every error, not only the first. Nothing executes if any error exists.
3. **execute**: root fields run in document order, one at a time (deterministic, cache-stable). Each field is resolved by its adapter; entries get labels; decorators apply; the header is built last.

Validation checks (code in capitals): unknown field `UNKNOWN_FIELD`; unknown argument `UNKNOWN_ARG`; missing required argument `MISSING_ARG`; value does not fit the declared type `TYPE_MISMATCH`; variable used but not defined `UNDEFINED_VARIABLE`; defined but unused `UNUSED_VARIABLE`; required variable not supplied `MISSING_VARIABLE`; unknown fragment `UNKNOWN_FRAGMENT`; fragment cycle `FRAGMENT_CYCLE`; unused fragment `UNUSED_FRAGMENT`; unknown directive or directive in the wrong place `UNKNOWN_DIRECTIVE`; selection set on a scalar or missing on an object `BAD_SELECTION`; duplicate response key in one selection set (same alias or name, different arguments) `KEY_CONFLICT`; unknown reducer name in `@reduce` `UNKNOWN_REDUCER`; `payload` selected while the effective payload mode is `none` `PAYLOAD_DENIED`; limits `LIMIT_DEPTH` (default maxDepth 5), `LIMIT_FIELDS` (maxFields 60), `LIMIT_FIRST` (first above maxFirst 100). Limits are policy attributes.

Directive set: `@include(if: Boolean!)`, `@skip(if: Boolean!)`, and the query decorators of section 2.3.

### 1.4 Entry fields

A field whose type is a list of a kind's type, or one entry of it, is an entry field (section 3). Entry fields take `first: Int` (default 20) and `after: String` (cursor, opaque, adapter-made) when they return lists. Each entry type also has two pseudo fields: `label` (the entry's label) and `payload` (the bulk content, subject to the payload decorator). Pseudo fields are listed in field listings after the declared ones.

### 1.5 Error shape

One shape for every stage and for refs:

```
{"message": String, "path"?: [String|Int], "locations"?: [{"line": Int, "column": Int}], "extensions": {"code": String, "stage": "parse"|"validate"|"execute"|"ref"}}
```

Results: `{"header": H, "data"?: {...}, "errors"?: [...]}`; `errors` is omitted when empty. Parse and validate failure: no `data`, and `header` is only `{"v":1,"q":"q1","ok":false}` (the query still takes an id). Execute failure of one field: that field is `null`, `errors` holds the entry with `path`, the rest of `data` stands, `header.ok` is `false`. Messages are fixed strings (listed in 4.5 for refs), so checks can compare them.

Example, validate failure for `{ turns(session: "sfixA", first: 2) { i rol } }`:

```
{"header":{"v":1,"q":"q1","ok":false},"errors":[{"message":"unknown field \"rol\" on FlowTurn (fields: i, role, chars, calls, tool, ok, payload, label)","locations":[{"line":1,"column":41}],"extensions":{"code":"UNKNOWN_FIELD","stage":"validate"}}]}
```

## 2. Result-set header

Every `run` returns a header, first key in the result. The header is the contract between the query and what the model may do next.

### 2.1 Fields (fixed key order; compact JSON)

| Key | Type | Meaning |
| --- | --- | --- |
| `v` | Int | header contract version, 1. Part of the cached bytes: a change is a new strategy id (OQ11) |
| `q` | String | query id `q<n>`, a per-surface counter starting at 1 |
| `op` | String or null | operation name |
| `ok` | Boolean | true iff there are no errors |
| `count` | Int | distinct entries labelled by this query |
| `pages` | [{path, first, total, next}] | one row per paginated entry field; `next` is the `after` cursor for the next page or null. Omitted when empty |
| `attrs` | Object | the flattened, deduped effective decorator attributes (2.2) |
| `src` | Object | for each attribute whose effective value did not come from the built-in default: `"query"`, `"policy"` or `"mixed"`; `{}` when all default |
| `kinds` | [Kind block] | one block per kind (3.4) |
| `reducers` | [row] | reducers applied (section 5). Omitted when empty |
| `refs` | [row] | declared interactions (4.2). Omitted when empty |
| `dropped` | [{what, why}] | what policy removed. Omitted when empty |
| `policy` | {id, rev, ov} | policy id, revision, and `ov`: attribute names the policy overrode |

Rule: an empty `pages`, `reducers`, `refs` or `dropped` is omitted, never `[]`. Same query, same policy, same state produces byte-identical header and data (Q20).

### 2.2 Flatten and dedupe

Each decorator has attributes with built-in defaults. A query can have many entry fields; their attribute values are flattened into one `attrs` object:

- H1. Attribute values are computed per entry field (path = response keys joined by `.`), as: policy lock, else the query's decorator argument, else policy default, else the built-in default.
- H2. If every entry field has the same value for an attribute, `attrs[name]` is that value once. If they differ, `attrs[name]` is an object `{path: value}` and only the differing paths are keyed (the most common value goes under `"*"`).
- H3. `src[name]` is `"policy"` if any path's value came from a policy lock or default, `"query"` if any came from a decorator argument, `"mixed"` if both; absent otherwise.
- H4. Kinds, labels and refs are deduped by entry identity: an entry is `(kind, key)`; if two paths return the same entry, it has one label, appears once in `kinds[].labels`, and `kinds[].paths` lists both paths.
- H5. Reducer rows with the same `(with, args, on, by)` are merged; `hit`, `in`, `out` are summed.
- H6. Refs rows with the same `(kind, op, names, via, max)` are merged; their `labels` are unioned. A row with no `labels` key covers every label of its kind in this query.
- H7. Policy `headerAttrs: "changed"` drops from `attrs` every attribute equal to the built-in default and not overridden (the preface then carries the defaults). Default `"all"`.

### 2.3 Query decorators and their attributes

A query decorator is a directive. Each owns one attribute with a built-in default; written on an entry field, it applies to that field and the selection under it.

| Decorator | Attribute | Values (built-in default first) | Applies |
| --- | --- | --- | --- |
| `@payload(mode, max)` | `payload` = `{mode, max}` | mode `"summary"`, `"full"`, `"none"`; max 200 | the `payload` pseudo field |
| `@reduce(with, ...args)` | `reducer` | `"none"`, or a registered reducer name | the `payload` pseudo field and `get` results |
| `@labels(as)` | `labels` | `"list"`, `"range"`, `"inline"`, `"none"` | the header listing |
| `@refs(ops, names)` | `refs` | `"infer"`, or an explicit set (4.3) | declared interactions |
| `@descriptor(mode)` | `descriptor` | `"first"`, `"always"`, `"off"` | materialized kinds (3.3) |
| `@scope(queries)` or `@scope(ticks)` | `scope` | `{"queries":8}`, `{"ticks":N}`, `"surface"` | label lifetime (4.4) |

`@payload` mode: `none` refuses the `payload` pseudo field (PAYLOAD_DENIED); `summary` returns it clipped to `max` characters by the default reducer (5.3); `full` returns it whole (then `@reduce`, if any).

A policy (section 5.2) can set any attribute's default, and can lock it so a query's decorator cannot change it. A decorator argument against a lock is not an error: the lock wins and the header records `src` `"policy"`.

### 2.4 Worked examples

All three start a fresh surface (`q1`), default policy `{id:"default", rev:1}`. Header and data are shown on separate lines; on the wire they are one compact JSON object.

**Example 1: a session's flow turns.** Real data: `scripts/fixtures/metrics-sessions.json`, session `sfixA` ("Fixture A: stem run", 11 messages; message 0 is a 369-character user turn, message 1 an assistant turn with 3 tool calls).

```
query Opening($s: ID!, $n: Int = 2) {
  head: turns(session: $s, first: $n) { ...T }
}
fragment T on FlowTurn { i role chars payload }
```
variables `{"s":"sfixA"}`. Header:

```
{"v":1,"q":"q1","op":"Opening","ok":true,"count":2,
 "pages":[{"path":"head","first":2,"total":11,"next":"2"}],
 "attrs":{"payload":{"mode":"summary","max":200},"reducer":"none","labels":"list","refs":"infer","descriptor":"first","scope":{"queries":8}},
 "src":{},
 "kinds":[{"kind":"flow-turn","paths":["head"],"n":2,"labels":["t0","t1"],"caps":{"get":true,"props":["i","role","chars","calls","tool","ok"],"set":[]}}],
 "reducers":[{"with":"clip","args":{"max":200},"on":["flow-turn.payload"],"by":"default","hit":1,"in":369,"out":209}],
 "refs":[{"kind":"flow-turn","op":"get","labels":["t0"],"via":"I2","max":12000},{"kind":"flow-turn","op":"property","names":["calls","tool","ok"],"via":"I3"}],
 "policy":{"id":"default","rev":1,"ov":[]}}
```
Data:

```
{"head":[{"i":0,"role":"user","chars":369,"payload":"SECRET-CONTENT please look at the repo and fix the thing, with a long enough request to count as a full turn xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...[+169]"},{"i":1,"role":"assistant","chars":14,"payload":"SECRET-CONTENT"}]}
```
Reading it: `t0` was clipped (reducer row, `hit` 1), so `get` is declared for `t0` only (staged intent I2). The unselected properties `calls`, `tool`, `ok` are declared for `property` (I3). `t1` fit and has nothing to expand.

**Example 2: the catalog concepts.** Real data: `catalog/concepts.jsonl` at dev 2c6b717; the adapter serves the current view (chain tails; a record named by a `supersedes` is not served). 50 current records have status `hypothesis`; the first two in file order are below.

```
{ concepts(status: "hypothesis", first: 2) { id name since } }
```
Header:

```
{"v":1,"q":"q1","op":null,"ok":true,"count":2,
 "pages":[{"path":"concepts","first":2,"total":50,"next":"2"}],
 "attrs":{"payload":{"mode":"summary","max":200},"reducer":"none","labels":"list","refs":"infer","descriptor":"first","scope":{"queries":8}},
 "src":{},
 "kinds":[{"kind":"concept","paths":["concepts"],"n":2,"labels":["tampqj","qblgkn"],"caps":{"get":true,"props":["id","name","status","since","supersedes","nmodels"],"set":[]}}],
 "refs":[{"kind":"concept","op":"get","via":"I1","max":12000},{"kind":"concept","op":"property","names":["status","supersedes","nmodels"],"via":"I3"}],
 "policy":{"id":"default","rev":1,"ov":[]}}
```
Data:

```
{"concepts":[{"id":"tampqj","name":"flow alteration by a second model","since":"2026-11-19"},{"id":"qblgkn","name":"warp","since":"2026-11-20"}]}
```
The concept's payload is its `claim`; it was not selected, so `get` is declared for all labels (I1). A follow-up: `query_ref({ref:"q1/tampqj", op:"get"})` returns `{"header":{"v":1,"q":"q1","label":"tampqj","op":"get","ok":true},"data":"A model given procedures and background swaps or alters turns in a flow."}`. No concept is settable: the catalog is append-only through inbox files, so `caps.set` is `[]` and a `set` is refused (4.5).

**Example 3: handles.** Shape from `app/handles.js` (`info` and `audit`). Handle records live in IndexedDB, so no fixture is committed; the values below are illustrative and Q18 builds them from a mock with the same `info`, `resolve` and `audit` interface. Handle `km7q2x` (kind `stem`, owner `sfixA`) was read twice by reader `sfixA` and re-pointed between the reads. The query's own `payload` read goes through `resolve(id, reader)` and is audited as a third row, which is why `total` is 3.

```
query H($h: ID!) {
  handle(id: $h) { id kind owner t readers payload }
  audit(id: $h, first: 2) { t reader h }
}
```
variables `{"h":"km7q2x"}`. Header:

```
{"v":1,"q":"q1","op":"H","ok":true,"count":3,
 "pages":[{"path":"audit","first":2,"total":3,"next":"2"}],
 "attrs":{"payload":{"mode":"summary","max":200},"reducer":"none","labels":"list","refs":"infer","descriptor":"first","scope":{"queries":8}},
 "src":{},
 "kinds":[{"kind":"handle","paths":["handle"],"n":1,"labels":["km7q2x"],"caps":{"get":true,"props":["id","kind","owner","t","readers"],"set":[]}},{"kind":"handle-audit","paths":["audit"],"n":2,"labels":["a0","a1"],"caps":{"get":false,"props":["n","t","id","reader","h"],"set":[]}}],
 "refs":[{"kind":"handle-audit","op":"property","names":["n","id"],"via":"I3"}],
 "policy":{"id":"default","rev":1,"ov":[]}}
```
Data:

```
{"handle":{"id":"km7q2x","kind":"stem","owner":"sfixA","t":1700000000150,"readers":["*","sfixA"],"payload":"stem 3 of 5 folded"},"audit":[{"t":1700000000100,"reader":"sfixA","h":"iok4xwb14t"},{"t":1700000000200,"reader":"sfixA","h":"1i0va4l66g"}]}
```
`handle` has every property selected and its payload inlined unreduced, so it declares nothing; `handle-audit` rows are not gettable (no payload) and declare `property` for the two unselected properties. The audit `h` values are the harness's content hash (first 10 chars of `contentHash`), never the text.

## 3. Kinds

A kind is the class of a result set's entries: it states what an entry is called (its label), what can be done with it, and how to fetch it.

### 3.1 Kind definition (adapter-supplied, validated at registration)

```
{
  name: 'flow-turn',            // unique across adapters; kebab-case
  type: 'FlowTurn',             // the schema object type its entries have
  label(entry, i, siblings),    // -> String, unique within one kind-in-one-query; stable for the same entry
  key(entry),                   // -> String, entry identity across paths (H4)
  props: ['i','role',...],      // top-level properties: scalars or small lists; the `property` op reads these
  gettable: true,               // has a payload
  settable: ['status'],         // property names `set` may write; [] if none
  fn(entry, what, ctx),         // -> payload or properties: what = {payload:true} or {props:[names]}
  set?(entry, name, value, ctx),// required iff settable is non-empty -> {value}
  materialized?: { descriptor: String }   // 3.3
}
```

`fn-to-get-payload-or-top-level-properties` is the single `fn`: `fn(entry, {payload:true})` is `get`; `fn(entry, {props:[...]})` is `property`; the pseudo field `payload` calls it too. It may be async. It never mutates.

### 3.2 Built-in kinds (the harness adapter, section 6.3)

| Kind | Type | Label | Props | Payload | Settable |
| --- | --- | --- | --- | --- | --- |
| `session` | Session | session id | id, title, created, msgs, requests | the system prompt | none |
| `flow-turn` | FlowTurn | `t<i>` | i, role, chars, calls, tool, ok | the turn's text content | none |
| `ledger-row` | LedgerRow | `r<n>` | n, t, model, strat, prompt, cached, cacheWrite, completion, reasoning, cost | none (not gettable) | none |
| `trail-row` | TrailRow | `k<n>` | n, t, tool, via, ok, chars, why, ref, out, ms | none | none |
| `checkpoint` | Checkpoint | checkpoint id | id, kind, len, t, session, writes, writeTokens, reads, readTokens | none | none |
| `handle` | Handle | handle id | id, kind, owner, t, readers | `resolve(id, reader)` text, audited | none in v1 (OQ6) |
| `handle-audit` | HandleAudit | `a<n>` | n, t, id, reader, h | none | none |
| `concept` | Concept | catalog id | id, name, status, since, supersedes, nmodels | the `claim` | none |
| `fault` | Fault | catalog id | id, model, class, seen, evidence | the `fault` text | none |
| `term` | Term | catalog id | id, term, since, see | the `means` text | none |

Notes. `flow-turn.calls` is the list of tool names on an assistant turn, `tool` the name a tool-result turn answers, `ok` false when a tool-result starts with `Tool error` or `Not run`. Index-labelled kinds use a one-letter prefix plus index; id-labelled kinds use their own id. Labels are readable names, not opaque handles (OQ2).

### 3.3 Materialized kind

A materialized kind is one whose payload is produced on request in a syntax of its own (rendered text, a table), not read as stored. Its definition adds `materialized: {descriptor}`: one short text explaining the syntax. The surface appends it to the kind's block in the header as `desc`:

- `@descriptor(mode: "first")` (default): `desc` is appended the first time that kind appears in this surface instance, and the kind block then carries `"desc":"sent"`; later headers carry `"desc":"seen"` and no text.
- `"always"`: the text is in every header that has the kind.
- `"off"`: no text; the block carries `"desc":"off"`.
- Preface flag: `createSurface({prefaced: ['turn-text', ...]})` or policy `prefaced`. A listed kind behaves as `"off"` and its block carries `"desc":"prefaced"`. This is for agents whose preface already holds the syntax.

A kind block with `materialized` also carries `"materialized":true`. The harness adapter v1 ships none (OQ13); the checks use a mock one. First candidate: `turn-text`, a flow turn rendered the way `app/context.js` renders it to the wire.

### 3.4 Kind block in the header

```
{"kind": String, "paths": [String], "n": Int, "labels": Labels, "caps": {"get": Boolean, "props": [String], "set": [String]}, "materialized"?: true, "desc"?: String}
```
`labels` per `@labels`: `"list"` an array; `"range"` a string `<prefix><a>..<prefix><b>` when all labels share a non-digit prefix with consecutive integer suffixes and `n >= 3`, otherwise an array; `"inline"` the header carries `{"n":N,"inline":true}` and each data entry carries `"_":"<label>"`; `"none"` the header carries `{"n":N}` (labels still addressable by data entries that select `label`). If `n` exceeds `labelsMax` (default 50) the list is replaced by `{"first":..,"last":..,"n":N}` and data entries carry `_` automatically, so the model can always see the label it would pass. Kind blocks are ordered by first appearance.

Label uniqueness: labels are unique within a query. If two kinds produce the same label, every colliding label is prefixed `<kind>:` and the block carries `"prefixed":true`. Entries reached by two paths are one entry (H4).

## 4. Query-ref

`query-ref(label, op)` acts on one label of a prior query. Tool form: `query_ref({ref, op, name?, value?, why?})`, `ref` being `<q>/<label>` (for example `q1/t0`).

### 4.1 Ops

| op | name | value | does | needs declared |
| --- | --- | --- | --- | --- |
| `get` | none | none | `fn(entry, {payload:true})`, then the effective reducer, capped at `max` characters | `get` for that label |
| `property` | a prop name | none | `fn(entry, {props:[name]})`, returns that one value | `property` including `name` |
| `set` | a settable prop name | the new value | `set(entry, name, value)`, returns what the adapter returns | `set` including `name` |

A ref result: `{"header":{"v":1,"q":Q,"label":L,"op":OP,"ok":true,"reducer"?: row},"data":VALUE}`; `reducer` is present only when a reducer changed the value (the 5.3 row). On refusal `ok:false` and `errors`. `get` cut at `max` ends with the clip marker (5.3).

### 4.2 Declared interactions (refs rows)

```
{"kind": String, "op": "get"|"property"|"set", "labels"?: [String], "names"?: [String], "via": String, "max"?: Int}
```
`via` records where the declaration came from: `"I1".."I4"` (staged intent), `"query"` (an `@refs` decorator), `"kind"` (never in v1: kinds declare capabilities, not interactions). Declared interactions are the only ones a ref may use: the check at ref time reads the stored header rows, not the kind.

### 4.3 Staged intent: what the surface infers

With `refs` = `"infer"` (default), for each entry field the surface adds rows by these rules, in order I1..I4, limited to the kind's capabilities `caps`:

- I1. `payload` not selected and the kind is gettable: `get` for all labels of that field. `max` is the policy `getMax` (default 12000).
- I2. `payload` selected and the reducer changed at least one entry: `get` for the labels that changed.
- I3. The selection names fewer than all the kind's `props`: `property` with `names` the unselected props, in kind order.
- I4. The selection names a prop in the kind's `settable`: `set` with `names` the selected settable props.

`@refs(ops: [...], names: [...])` replaces inference for that field: the listed ops, intersected with `caps`, with `names` limiting `property` and `set`; `via` is `"query"`. `@refs(ops: [])` declares nothing. Policy then removes what it forbids (4.5); each removal is listed in `dropped` as `{"what":"refs.set","why":"policy:deny set"}`.

### 4.4 Scope and expiry

A query's scope is the kinds and labels in its header plus the attribute `scope`:

- `{"queries": N}` (default 8): the query is valid while it is among the N most recent queries of that surface instance. The (N+1)th later query expires it.
- `{"ticks": N}`: valid for N calls to `surface.tick()` (the host calls it once per model request).
- `"surface"`: valid until the surface is discarded.

A ref names the query id, so it can only act on its own query's labels. A new surface instance has no memory of earlier ones (a ref to an earlier instance's query is `unknown query`). Re-running the same text makes a new query with a new id.

### 4.5 Refusals (exact messages; no adapter `fn` or `set` is called when a ref is refused)

| Code | Message |
| --- | --- |
| `REF_FORMAT` | `ref must be <query>/<label>, for example q1/t0` |
| `REF_UNKNOWN_QUERY` | `unknown query q9` |
| `REF_EXPIRED` | `query q1 expired (scope: 8 queries); run the query again` |
| `REF_UNKNOWN_LABEL` | `q1 has no label t9` |
| `REF_NOT_DECLARED` | `q1/t0: op "set" is not declared by this query (declared: get, property[calls,tool,ok])` |
| `REF_BAD_NAME` | `q1/t0: property "foo" is not declared (declared: calls, tool, ok)` |
| `REF_BAD_VALUE` | `q1/t0: set status needs a value` (or the adapter's message, stage `ref`) |
| `REF_POLICY` | `q1/t0: op "set" is refused by policy` |
| `REF_SOURCE` | the adapter's error message, with the label (execute-stage failure of `fn` or `set`) |

`declared:` lists the ops declared for that label (ops in the order get, property, set; `property[...]` and `set[...]` show names), or `declared: none`. `set` on a kind with `settable: []` is `REF_NOT_DECLARED`.

### 4.6 Audit

Every run and every ref appends a row to `surface.audit()`, outside anything the model reads: `{t, q, label?, op?, ok, code?, why?, h}` where `h` is the content hash of what was returned, never the text. `why`, when given, is recorded as given (cut to 200 characters, the trail's rule). Policy `requireWhy: [ops]` (default `[]`, restrictions being off by default) makes a ref without `why` a `REF_BAD_VALUE`.

## 5. Reducer hook

A reducer is a pure function `(value, args, ctx) -> value | {value, note?}` registered by name: `createSurface({reducers: {name: fn}})`. The hook is the one place a payload passes through one before it enters `data` (inline `payload`) or a ref result (`get`). Reducers are where TEXT STRIPING and the existing outstore helpers (`squeeze`, `shortlist`) later plug in; this piece defines none of their behavior.

### 5.1 Built-ins (so the hook has something to check)

- `none`: identity.
- `clip(max)`: if the string is longer than `max + 16`, `value.slice(0, max) + "...[+N]"` where N is the removed count; otherwise unchanged.
- `lines(head, tail)`: keeps the first `head` and last `tail` lines, with one `...[+N lines]` between.
- `omit`: returns the empty string (for a policy that bans a field's text outright).

### 5.2 Policy

A policy is a plain object, no regexes, no DOM:

```
{
  id, rev,
  defaults: {attr: value},        // attribute defaults (2.3)
  locks: [attr],                  // attributes a query decorator cannot change
  reducers: [{when: {kind, prop?, minChars?}, with, args}],   // first match picks the reducer for a payload
  verbose: true,                  // false: payload mode "full" is downgraded to "summary"; get capped at summary max
  deny: [op],                     // refs removed (4.3), for example ["set"]
  limits: {maxDepth, maxFields, maxFirst, defaultFirst, getMax, labelsMax},
  requireWhy: [op], prefaced: [kind], headerAttrs: "all"|"changed"
}
```
Resolution order for the reducer of a payload: policy `locks` for `reducer`, else `@reduce` on the field, else the first matching policy `reducers` row, else policy `defaults.reducer`, else the payload-mode default (`summary` implies `clip(max)`), else `none`. The mapping from `app/policy.js` items (tool-call regex rules, a different shape) is a later piece (OQ8).

### 5.3 What the header records

One row per distinct `(with, args, on, by)`: `{"with","args","on":["<kind>.payload"],"by":"query"|"policy"|"default","hit":Int,"in":Int,"out":Int}`; `hit` entries changed, `in` and `out` the summed string lengths of those entries before and after. `by` is `"default"` for the payload-mode clip. Entries a reducer left unchanged are not counted. A reducer that throws: the entry's payload is withheld (`null`), an execute error with code `REDUCER_FAILED` names it, and the raw value never enters `data`. Policy changes to the reducer change the header and the payload and nothing else.

## 6. Data-source seam

### 6.1 Adapter interface

```
adapter = {
  name: 'harness',
  schema: {
    types:  { FlowTurn: {fields: {i:'Int', role:'String', chars:'Int', calls:'[String]', tool:'String', ok:'Boolean'}, kind:'flow-turn'}, ... },
    roots:  { turns: {type:'[FlowTurn]', args:{session:'ID!', role:'String', first:'Int', after:'String'}}, ... },
  },
  kinds:   { 'flow-turn': {name, type, label, key, props, gettable, settable, fn, set?, materialized?}, ... },
  resolve(root, args, ctx) -> {entries: [...], total?: Int, next?: String|null}   // may be async; a scalar root returns {value}
}
```
`ctx` = `{reader, now, vars}`; `reader` is who is asking (a session id), as handles use it for per-reader views.

The surface merges the schemas of all adapters; a duplicate root field or kind name is a registration error (`DUPLICATE_ROOT`, `DUPLICATE_KIND`). It validates every kind definition at registration (3.1): missing `label`, `key`, `props` or `fn`, `settable` non-empty without `set`, a settable name not in `props` are registration errors.

### 6.2 Standalone proof

A mock adapter (in-memory) is the whole of Q1 to Q21; only Q22 needs the harness adapter. The surface module and its siblings import nothing outside `app/query*.js`; the module loads under plain node with `window`, `document`, `indexedDB`, `localStorage` undefined (Q17).

### 6.3 Harness adapter

`app/query-harness.js` is the only file that may know harness shapes. Its sources are injected, not imported, so it is testable with fixtures: `{sessions(): [...], ckpt(): {...}, trail(): [...], handles: {info, resolve, audit}, catalog(): {concepts, faults, terms}}`. At integration the page passes `store`, `checkpoints`, `patterns.trail`, `handles` and a catalog loader. Roots: `turns(session, role?, first?, after?)`, `ledger(session, first?, after?)`, `sessions(first?, after?)`, `session(id)`, `trail(tool?, first?, after?)`, `checkpoints(session?)`, `handle(id)`, `audit(id, first?, after?)`, `concepts(status?, model?, first?, after?)`, `faults(model?, class?, first?, after?)`, `terms(match?, first?, after?)`. The catalog roots serve the current view: the tail of each `supersedes` chain.

### 6.4 Synopsis

`surface.synopsis()` and the root field `__synopsis` return the query shape (the compact schema: roots, their arguments, each type's fields and kind). The synopsis is plain text, deterministic, and the bytes a preface can carry. It is not part of any header.

## 7. Contracts

Checks are at seams and at interactions between seams; each is observable. Seams: parser, validator, executor, header builder, reducer hook, ref gate, adapter. Spec home: `scripts/test-query.mjs`.

- Q1. **Parse the subset.** Every grammar form in 1.1 parses to an AST; each `Out` form in 1.2 fails with PARSE and `unsupported: <word>`; errors carry `line` and `column`.
- Q2. **Validate collects everything.** A query with three faults returns three errors, each `stage:"validate"` with the code listed in 1.3; nothing executes (the mock adapter's `resolve` is not called).
- Q3. **Variables, aliases, fragments, skip and include.** Defaults apply, missing required variables are MISSING_VARIABLE, `data` is keyed by alias, fragments expand, `@skip`/`@include` drop fields.
- Q4. **Error shape.** All stages produce `{message, path?, locations?, extensions:{code,stage}}`; parse and validate failure give `header` = `{"v":1,"q":"q1","ok":false}` and no `data`; an execute failure nulls one field and keeps the rest with `ok:false`.
- Q5. **Flatten and dedupe.** Two entry fields over one kind give one kind block with merged `paths`, union labels, and entries deduped by `key` (H4); uniform attributes are scalars, differing ones are keyed by path (H2); equal reducer rows merge (H5).
- Q6. **Default attributes and policy override.** A query with no decorators gets the built-in defaults; a policy `defaults` entry changes them and `src` says `"policy"`; a `locks` entry beats a query decorator; `headerAttrs:"changed"` drops built-in-default attributes (H7).
- Q7. **Decorators.** Each decorator in 2.3 parses, is accepted only where listed, sets its attribute for the field and under it, and unknown ones are UNKNOWN_DIRECTIVE.
- Q8. **Payload modes.** `none` refuses `payload` (PAYLOAD_DENIED); `summary` clips above `max + 16` with the `...[+N]` marker and records the reducer row `by:"default"`; `full` returns whole; below the threshold nothing is recorded.
- Q9. **Reducer hook.** A registered reducer named in `@reduce` or chosen by a policy row is applied to the payload before it enters `data`, the header row is `{with,args,on,by,hit,in,out}` with correct counts, an unknown name is UNKNOWN_REDUCER, a throwing reducer withholds the payload and raises REDUCER_FAILED.
- Q10. **Policy shapes the result.** `verbose:false` downgrades `full` to `summary` and caps `get`, with `dropped` entries; `deny:["set"]` removes `set` refs with a `dropped` row; the same query under two policies differs only where the policy touches (header attrs, src, reducers, dropped, refs, payload text).
- Q11. **Kind registration and caps.** A kind definition missing a required member, or a settable name not in `props`, is refused at registration; `caps` in the header equal the definition; `get:false` kinds never declare `get`.
- Q12. **Labels.** Index and id labels, uniqueness within a query, collision prefixing with `prefixed:true`, the four `@labels` modes (`list`, `range` rule, `inline`, `none`), the `labelsMax` fallback with automatic `_`.
- Q13. **Materialized kinds.** The descriptor is appended per `first`, `always`, `off`; a prefaced kind carries `desc:"prefaced"`; `first` sends once and then `seen`.
- Q14. **Staged intent.** Rules I1..I4 give exactly the refs rows of the examples in 2.4 (Examples 1 to 3 are the golden cases); `@refs` overrides inference with `via:"query"`; an empty `@refs(ops: [])` declares nothing.
- Q15. **Ref ops.** `get`, `property`, `set` return their values through `fn` and `set`; `get` applies the effective reducer and the `max` cap; the ref header has the 4.1 shape.
- Q16. **Ref refusals.** Each code in 4.5 with its exact message; the adapter's `fn` and `set` are not called on a refusal; an undeclared op is refused even though the kind supports it.
- Q17. **Scope and expiry.** A query leaves scope after N later queries (`queries`), N `tick()` calls (`ticks`), or never (`surface`); refs to it then give REF_EXPIRED; another surface instance gives REF_UNKNOWN_QUERY.
- Q18. **Audit.** `audit()` has one row per run and per ref (including refusals) with `h` and no text, `why` cut to 200 characters, `requireWhy` enforced.
- Q19. **Adapter seam and standalone.** Two adapters merge into one schema; duplicate root or kind names are registration errors; the module graph loads in plain node with no DOM or storage globals; a mock adapter alone passes Q1 to Q18.
- Q20. **Determinism.** The same text, variables, policy and state give byte-identical header and data JSON, with fixed key order (2.1); a re-run gets a new `q` and otherwise the same bytes.
- Q21. **Pagination.** `first` default and `maxFirst`, `after` round-trips the adapter's cursor, `pages` rows carry `total` and `next` (null on the last page), count matches entries labelled.
- Q22. **Harness adapter over fixtures.** (Interaction: adapter and the stored shapes.) Example 1 and Example 2 reproduce literally from `scripts/fixtures/metrics-sessions.json` and a catalog fixture copy; the catalog roots serve the supersedes-chain tail; handle `payload` goes through `resolve(id, reader)` and adds one audit row.

## 8. Open questions and decisions

Each is a decision taken now to avoid blocking, flagged to measure at step 5 (a production-style session per `docs/concepts/PROGRAMME.md`, never a model's own report). Provisional thresholds are written down before any run and can be revised only by a new record.

- OQ1. Subset size: queries only, one operation, no inline fragments or introspection. Decision: as 1.1 and 1.2. Measure: the share of model queries that fail at parse or validate (target under 15% by the third query of a session).
- OQ2. Label form: readable names (`t3`, catalog id), not opaque handles. Decision: readable, because a label is a name inside one query's scope, not a reference that must survive context re-pointing. Measure: mis-referenced labels (REF_UNKNOWN_LABEL per ref) under 5%.
- OQ3. Ref string: `<q>/<label>`, query ids a per-surface counter. Decision: as 4. Measure: REF_FORMAT rate.
- OQ4. Default scope `{queries:8}`. Decision: as 2.3. Measure: REF_EXPIRED rate; if the model re-queries instead of refs, raise it.
- OQ5. Payload defaults: summary clip 200, `getMax` 12000 (the `READ_MAX` of `app/outstore.js`). Decision: as stated. Measure: result tokens against reading the same data with `output_read`/`entry_read`.
- OQ6. Settable kinds: none in the harness adapter v1; the first candidate is `handle` with a settable `view` (re-point via `handles.point`, audited). Decision: v1 read-only so that `set` is exercised by the mock kind only. Reason: steering through handles belongs to the harness (warp), not to the model, until measured.
- OQ7. Descriptor `first` state lives per surface instance. Decision: a fork or stem gets a new instance and so re-sends. Measure: descriptor tokens over a session against `always`.
- OQ8. Policy shape: a plain object (5.2), separate from `app/policy.js` (tool-call regex rules). Decision: separate; a later adapter maps one into the other. No restriction is on by default (CLAUDE.md): `deny`, `locks`, `requireWhy` are empty.
- OQ9. Staged intent: four inference rules. Decision: as 4.3. Measure: how often the model uses an inferred `get` or `property` against re-running a query (the drill-in rate concern in `docs/TENETS.md`).
- OQ10. Synopsis by `__synopsis` and `surface.synopsis()`, not by GraphQL introspection. Decision: compact text, preface-carried. Ties to query shape as the synopsis.
- OQ11. Strategy id: the tool schemas, the header form (`v`) and the descriptor text are model-visible, so the query surface lands behind a new strategy major version, never as an edit to a cached one.
- OQ12. No dependency. Decision: a hand-written parser (about 400 lines); `graphql-js` is large, needs a build, and brings introspection and features we exclude. Reconsider only if the subset grows.
- OQ13. Materialized kinds in the harness adapter: none in v1 (mock only); the first candidate is `turn-text`. The descriptor is droppable by the preface flag.
- OQ14. Header form: compact JSON, a single line. Decision: JSON for exactness. Measure: header tokens as a share of result tokens (target under 25% on the three examples), and a terse text form as an alternative if above.
- OQ15. Text striping: the sibling piece registers reducers by name at the hook (5). Decision: no striping behavior is specified here.
- OQ16. Relation to `output_read` and `entry_read`: coexist. A later kind `output` could expose `os:` handles through `get`; not in v1.

## 9. Proposed files

- `app/query.js`: `createSurface` and the public API (run, ref, audit, tick, synopsis); stage orchestration.
- `app/query-parse.js`: lexer and parser (AST, PARSE errors).
- `app/query-validate.js`: schema merge, validation, limits.
- `app/query-header.js`: attributes, flatten and dedupe, kind blocks, labels, refs inference, reducer rows, serialization with fixed key order.
- `app/query-ref.js`: ref gate, scope, refusals, audit.
- `app/query-reducers.js`: the built-ins of 5.1 and the policy resolution of 5.2.
- `app/query-harness.js`: the harness adapter (6.3), the only file that knows harness shapes; takes injected sources.
- `scripts/test-query.mjs`: plain node, no browser, mock data and `scripts/fixtures/` only; a ci suite named `query` added to `scripts/ci.mjs` (`FILES` map). Fixtures: `scripts/fixtures/metrics-sessions.json` (existing) and a small catalog fixture copy for Example 2 (new, by `seams`).
- Later joins, each its own piece with a spec first: tools `query` and `query_ref` in `app/tools.js` (the `fn(...)` shape; trail rows already carry `ref` and `why`), a card for the result (`ui`), the policy mapping from `app/policy.js`, a new strategy id (OQ11), an entry in `docs/PROTOCOL.md`.

## 10. Decisions taken at implementation

Where this document was silent, `app/query*.js` chose as follows (step 4; no check was changed).

- `policy.ov` lists only locks that overrode a decorator that was present.
- With `verbose: false` the dropped row is `{what: 'payload.mode full', why: 'policy:verbose false'}`; a header ref `max` is the smaller of `getMax` and the summary max.
- Labels mode, descriptor mode and ref scope of a kind or query come from its first path.
- Error codes: `NO_OPERATION` (no operation to run), `BAD_SELECTION` (`payload` on a kind that is not gettable; fragment type mismatch), `TYPE_MISMATCH` (negative `first`), `RESOLVE_FAILED` (a root or payload failure; path `[key]` or the payload path), `REDUCER_FAILED` (message names the reducer, never the raw value).
- A data entry's `_` is appended last. The ref gate checks, in order: format, unknown query, expired, unknown label, policy deny (live policy), requireWhy, declared, name, value, then the source call. A ref with a property or set op and no name is `REF_BAD_NAME`.
- Expiry: a query scope of N expires when later queries exceed N; a tick scope when ticks since exceed N.
- The `get` cap clip is not a reducer row.
- The audit hash is cyrb53 (base 36) over the JSON of the returned data, or of `[code, message]` for a refusal.
- The materialized descriptor block carries `desc` (`sent`, `seen`, `always`, `off`, `prefaced`) and, when sent or always, `text`.
- `kinds` is `[]` for a query that selects only scalars.
- A property op whose name is absent from the kind function's result falls back to `entry[name]`.
- Harness adapter: ledger rows get a 1-based `n` from stored order, trail rows `n` likewise, audit labels are `a<n>` from 0; concepts serve chain tails only, in file order; a handle payload resolves through the injected `handles.resolve(id, reader)`.
- Q22 deviation, fixed: the first implementation served every line of the `faults` and `terms` roots, so superseded records leaked, while Q22 requires the chain tail for the catalog roots. The fixture then in use held no superseded fault or term, so the check stayed green. A check with a superseded fault and a superseded term was added (790e379, red), and `faults` and `terms` now share the chain-tail filter with `concepts` (3fb4fa9).
