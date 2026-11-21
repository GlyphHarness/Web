# Query surface and text striping on the app platform

Status: hypothesis. Built on the platform side: nothing. Source: two sibling pieces named and specified by `context` in other worktrees (branches `query-surface`, `stripe-surface`; at the time of writing neither has a commit past dev 2c6b717). Their prose will be `docs/QUERY.md` and `docs/STRIPE.md`; their terms (query-ref, result-set header, query decorator, kinds, materialized-kind, staged intent, striped skeleton, reducer class, analyzed-before indicator) are theirs and are not re-recorded here. This note maps them onto the platform (docs/platform/README.md A1-A7) and adds only the platform-side terms below.
Built in the harness today, stated apart (docs/TENETS.md): trail row per tool call (18), output store handles and deterministic squeeze (13, 25), handles (swhuvh), has/has-not view (hnuspc, built and measured per docs/concepts/INVENTORY.md). Everything else here is hypothesis.

## Terms
New (nomenclature inbox `catalog/inbox/platform-uvwzeg.jsonl`): ref lifetime (vliqts), label scope (wpgkqs), claim limit (tzacvg).
Reused: event record lvdddu, as-of read cifgws, enumerated invalidation dvovnc, enumerable result set kctczv, protocol catalog lroksy, default protocol botoyv, provenance vwjhrd, ingested source ougwwn, trace guard tdxcee, knockout mkohts, epoch pin hcipca, handle swhuvh, passive marker fjcvwq, command alias yijgei, result shape rfeeue, has/has-not view hnuspc.
"Declared interaction" is used as the operator uses it: an operation on a result label that the query announced. Sibling-named; not duplicated.

## (a) Relation to A1-A7
Placement: the query surface is not a seventh contract. It is an exchange-layer platform protocol (`query`, a catalog record, PH4) over the store contract (versions, as-of reads), plus one generic `ref` contract. Smallest set stays six (PH2). Check that would refute: per-ref lifetimes need state the store contract cannot keep (a ref table as store keys with versions).

| A | relation | how |
| --- | --- | --- |
| A1 contracts as data (PH1 hjltjz) | instance, extended | `ref` contract: operations property(label, name), get(label), set(label, value, version); errors unknown-label, undeclared, stale, terminated, withheld, no-lifetime. Extension: which operations a label offers is derived per result from the query shape, so a contract instance (the declared set) has a lifetime; only the static `ref` contract is versioned. |
| A2 protocol-first (PH3 cvycil) | instance | A query is a named exchange; labels give no ambient read: a value is reachable only through `ref` calls the result declared. Same discipline as "no ambient fetch". |
| A3 protocol catalog (PH4 ghttaf) | instance | Header decorator defaults, exposure policy, descriptor elision, ref lifetime values are catalog records; omitted -> catalog default per layer; none found -> named error, no code default. |
| A3 enumerable result set (PH6 mvfezw) | instance, with a conflict | Header = member list with count and cursor. Conflict: PH6 wants ids stable until a recorded change; labels are terse aliases for small models (wrqmen). Resolution: alias is stable only inside its ref lifetime and scoped to its result (label scope); the member id behind it is the PH6 stable id. |
| A3 enumerated invalidation (PH5 ydsgja) | instance | A label terminates when its member id is enumerated as invalidated; other labels of the same result stay valid. |
| A3 regulatory records (PH7 eeroue) | composes | A data-minimization outcome is an exposure policy result: it reduces the view and the reduction is marked (c). |
| A4 trust (PH9 cvmhly) | instance | Result payload and names are ingested data with provenance; `set` is an effect and needs a delegation. See (c). |
| A5 event records (PH11 dgtcqd), as-of (PH12 gsioti) | instance | A result is an event record at its as-of timestamp; `get` is an as-of read. See (b). |
| A6 (PH13 vsbder, PH14 tllxhx, PH15 fgsoab) | instance | Each ref call is an at-time function; expiry sits on an epoch-pinned boundary; a failed guard knocks out dependent `set` effects. |
| A7 look | none | Header and descriptor are text for a consumer, not a surface. |

Conflicts with CLAUDE.md (restrictions are options, off by default): the declared set is the only way to address a label, so it is the mechanism, not a deny rule. Any narrowing beyond what the shape infers (hiding a gettable property, capping verbosity) is exposure policy, an option; its default is the catalog default (all that the shape declares, header counts shown).

Seam chain (composition order, each a pure function of records): query text -> parse and shape -> declare (labels, ops, lifetime) -> exposure policy -> reducer (striping) -> header -> [consumer calls] -> ref resolve -> store (as-of read, compare-and-set) -> trail row. Both siblings are pure modules (records in, records out, timestamps as arguments), so they are the cheapest first candidates for PH1's check (same record, JS and wasm binding, equal results); that is a proposal, not a plan.

## (b) Staged intent as a time-positional flow
Model (hypothesis): a query result is one event record (time.md): id, source (the consumer session), start = as-of timestamp T of the reads, transitions, payload (header, declared set hash), rule (timestamp rule id). It is immutable. The staged intent is that record plus the follow-ups it declared; follow-ups are inferred from the query shape (selected fields -> property/get; fields the data kind contract marks settable -> set), nothing else exists.
- Declaration record (per result): result_id, query_hash, policy_id, as_of, labels[{alias, name, kind, member_id, version, ops}], declared_hash, lifetime {begin, expires_at, terminators}.
- Begins: a label's lifetime begins at transition `issued` (the result is delivered to the consumer), valid reads are as-of T. A label never exists before its result and cannot be forged ahead of it.
- Ends: exactly one terminator, a closed set carried as data: completed (a declared terminal interaction ran), invalidated (member enumerated as changed after T, PH5), superseded (a later result issued a label for the same member; most recent wins, as C7 passive markers), expired (expires_at, the first multiple of the interval n at or after T + min life; n and min life are catalog data, epoch-pinned as PH13, so refs of equal interval expire together), epoch-fold (session epoch or stem fold, TENETS 15; the old session is not edited, refs do not cross it unless re-queried), revoked (delegation or policy record superseded). No terminator record in the catalog -> named error `no-lifetime`, never an unbounded ref ("never-terminating" is excluded by construction).
- After a terminator: `get` still answers as-of T from the trail (replay-stable) but is marked terminated; `set` and new `property` calls are refused with `terminated` or `stale`.
- `get` is an as-of read at T, never a read of current state; fresh data is a new query (a new result, new labels).
- `set` is compare-and-set against the version stamp in the declaration; version moved -> `stale`. A write is an effect: it names a delegation, writes a version to the timeline (by = run id), and a failed trace guard over the query run knocks it out (tombstone, PH15, with its early-cutoff bound).
- Each ref call is an at-time function (tllxhx): inputs (declaration record, label, op, call timestamp), outputs, effects declared. No scheduled follow-up (auto refresh, subscription) unless a result declares it with a pinned interval; none is inferred.
- Flow trail records, per staged intent, as event records with transitions: query (shape hash, policy id, decorator id, descriptor appended or elided with preface hash), header (counts per kind, reduction marks), declared set (hash, count), each ref call and outcome (label alias, op, argument shape, outcome, size, time, session: exactly harness trail row 18), terminator and cause. It does not record payload values (linked by handle, TENETS 20) or message text. Derivation claim: this is the existing trail plus the declaration record; no new store (P-Q6).
- Flow-lint reading: the declared set is a projection in the gwokxx sense (what may follow); ref calls are what occurred; a call outside it is a mismatch and is refused. This is a concrete case for README Q4's alternate reading (guard projects what should follow and compares to occurred); both readings fit the same data, Q4 stays open.
- Relation to handles: a handle keeps fixed bytes while what it resolves to is re-pointed (ndgwdh, warp). A label is the opposite pole: resolution pinned to T, bounded in time. Re-pointing a label is a new result. A stem inherits `get` of its core's refs and not `set` (hypothesis; check against docs/STEMS.md before it is relied on).

## (c) Trust: exposure and striping
Stance (trust.md): result payload and the member names are ingested sources; derived data keeps parent provenance (PH9). The query/stripe outputs are derived data and add provenance steps (reducer class, policy id); they never raise authority.
- Label scope: a label resolves only against the result whose header declared it. Names in the header are data; the alias that `ref` accepts is platform-issued and not copied from content. Payload text that spells another alias, or imitates a declared interaction, mints nothing. Duplicate names in one header are disambiguated by the platform deterministically.
- Claim limit: a reduced view (policy exposure or striped skeleton) may claim only: these spans or entries exist in the source as of T, in this order, with these omitted counts and this reducer class. It may not claim absence ("no X in the blob"), completeness, equivalence with the source, or safety (that omitted spans carry no instruction). It is held-not-checked in has/has-not terms (INVENTORY invariant 3: a capture never stands in for content not read). A reducer that is a model is flagged as such (invariant 4, one cent per operation pppezv).
- Knowing it was reduced: the header carries a reduction mark per reduced entry or blob (reducer class, policy id, whole-blob digest, omitted counts, analyzed-before indicator, as-of). Silent reduction is not allowed; a policy may hide the counts (option, off by default) but still emits "reduced: restricted". Inline omission markers are ingested-forgeable (a source can contain the same text), so their number must equal the mark's count; a mismatch is flagged.
- Policy is not the consumer's: exposure policy, decorator defaults and descriptor elision are catalog records changed only on the authoring path under the principal (Q1 reading (a)); data kinds that hold policy, delegations or the catalog declare no `set`, so no query shape can offer it.
- Descriptor: the auto-appended descriptor is platform-authored (not ingested), so it may state syntax and declared interactions. It never embeds ingested text. Dropping it is allowed only when the session record shows the preface (by hash); the trail records the elision and the hash; unknown hash -> append.
- Risks, kept not claimed: rarity and Zipf heuristics preferentially keep unusual spans, which is where injected instructions sit; an attacker can also shift whole-blob versus sub-chunk statistics to get chosen spans kept or dropped. The skeleton is therefore data, subject to the claim limit, never a filter that clears content. Whether the stripe helps a model decide is the sibling's measurement, not claimed here.

## Hypotheses (catalog records in the inbox; all status hypothesis, no per-model entries)
Siblings' concept ids are not in the catalog yet; cited by path until the steward merges them: docs/QUERY.md (query surface, query-ref, header) and docs/STRIPE.md (striping).

P-Q1 Declared set is a pure function of the query (dtroyx).
Claim: the follow-up actions of a result are determined by query text, data kind contracts and policy alone; only those are callable.
Holds if: the same query text and policy yield the same declared_hash on two runs and in two bindings; every call outside the set is refused with `undeclared`; a field is settable in the set iff its kind contract marks it settable and the shape selected it.
Fails if: an action works that the declared set did not list, or the set depends on hidden state.
Ties: hjltjz, cvycil (instances); xagosf, klsrrk, vtpcxq (query shape and result shaping, harness side); docs/QUERY.md.
Replaces: ambient get/set by id; free-form "act on a fetched item" calls.
Seam: query module -> ref module. Cost: shape inference for nested selections; kind contracts must declare settability.

P-Q2 A ref has a bounded, replayable lifetime (rfrmyw).
Claim: every label begins at its result's as-of time and ends at exactly one terminator from a catalog-held closed set; `get` is an as-of read; `set` is compare-and-set on the declared version.
Holds if: replaying the trail reproduces every `get` output, including after invalidation; no ref call succeeds after its terminator; a `set` after the member changed is refused `stale`; expiry times fall on the epoch grid of the catalog interval.
Fails if: any label stays usable with no terminator record, or a replay differs.
Ties: gsioti, dgtcqd, ydsgja, vsbder (time and cache side); fgsoab (voided `set`); swhuvh (handle contrast).
Replaces: refs and handles with implicit, unbounded validity.
Seam: ref module -> store contract. Cost: a ref table with versions; retention of results for replay.

P-Q3 A reduced view is marked and bounded in what it claims (uafkiu).
Claim: a reduced view carries a reduction mark in its header, so a consumer can tell from the header alone that it was reduced, and supports only existence, position and count claims.
Holds if: for a corpus of blobs including ones that contain marker-like text, the inline omission-marker count equals the mark's count except where text was forged, and every forged marker is flagged; the reducer is deterministic (same blob, policy and statistics scope give the same skeleton); a validator rejects a derived claim of absence or completeness.
Fails if: a reduction can be present with no mark, or forged markers pass unflagged.
Ties: cvmhly (derived data keeps provenance); hnuspc (held versus checked); docs/STRIPE.md.
Replaces: unmarked truncation (head and tail) as the only way a long blob is cut.
Seam: reducer -> header. Cost: a digest and counts per reduced blob; a claim validator.

P-Q4 Labels are scoped and not forgeable from content (uczpdw).
Claim: a label resolves only inside its declaring result, aliases are platform-issued, and ingested names, payload text or fake declarations cannot mint a callable ref.
Holds if: an alias taken from header A is refused against result B; a payload that spells a valid alias or lists a fake interaction yields no ref and no declared op; duplicate names get distinct aliases.
Fails if: any content-derived string resolves to a ref it was not issued.
Ties: cvmhly (ingested distrust); glxylm (passive markers, recency), wrqmen (alias); fault hqvmzk (made-up handle) as the failure this guards.
Replaces: references by free name or global id.
Seam: ref resolve. Cost: per-result alias table; alias length for small models.

P-Q5 Exposure policy is catalog data the consumer cannot loosen (qaeeyl).
Claim: exposure policy, header decorator defaults and descriptor elision are catalog records with catalog defaults; a consumer, ingested content or a `set` can change none of them.
Holds if: changing the default record changes result headers with no code change; removing it gives the named error; no query shape declares `set` on a policy, delegation or catalog kind; each result's trail row names the policy id.
Fails if: any consumer-reachable call alters exposure for itself.
Ties: ghttaf, eeroue (protocol records), cvmhly (Q1 reading (a)); docs/QUERY.md.
Replaces: verbosity and elision rules fixed in code.
Seam: policy -> declare/header. Cost: policy authoring path; every restriction is an option, off by default (CLAUDE.md).

P-Q6 The flow trail of a staged intent needs no new store (sxhqpk).
Claim: query, header, declared set, ref calls and terminator are reconstructible from existing trail rows plus the declaration record, so flow lint can compute declared-versus-occurred from them.
Holds if: from trail rows and declaration records alone, a script lists per result the declared set, the calls made, the refused calls and the terminator cause, matching a live run; no payload value and no message text is needed.
Fails if: the reconstruction needs a field that exists nowhere in the trail or declaration.
Ties: knilmc (flow lint), dgtcqd (event records); TENETS 18 (trail row); gwokxx (projection); Q4.
Replaces: bespoke per-feature logging.
Seam: trail. Cost: declaration record kept; hash of declared set per result.

## Kept (rejected or unproven, with the reason)
- A seventh core contract for query: rejected; store plus a protocol record cover it, smallest set first.
- Refs with no terminator, or subscription and auto-refresh by default: rejected; never-terminating by construction, and a scheduled tick is a declared option.
- Label as a global name: rejected; collisions and forgery; scope per result.
- Last-writer-wins `set`: rejected (time.md Kept); compare-and-set on the version stamp.
- Silent reduction or elision: rejected; a reduced view always says so.
- Always-inline descriptor: rejected as default; elision backed by a preface hash.
- GraphQL mutations and subscriptions as language features: not adopted; `set` is declared on the ref, subscriptions are scheduled functions. GraphQL introspection and cursor connections are prior-art names from memory, unverified (survey S3.2 listed cursor connections).
- Unproven: that a striped skeleton helps a model; that hypermedia-style declared actions (response lists the next actions, a known pattern named from memory, unverified) reduce made-up references in small models. Both belong to context measurements.

## Open questions and decisions taken (none asked of anyone; each revisable by the operator)
1. Label: name or issued alias? Decision: alias token scoped to the result, name shown beside as data. If QUERY.md fixes the name as the label, the scope rule (P-Q4) still applies.
2. `set` semantics? Decision: compare-and-set on the declared version.
3. Default ref lifetime? Decision: catalog data (interval n, min life, epoch-pinned); none -> `no-lifetime` error.
4. May a write take a reduced view as its base (read-modify-write)? Decision: no by default; the write carries the reduction mark as provenance; a require-full-read rule is an option, off by default.
5. Are withheld counts shown? Decision: yes by default; hiding them is a policy option.
6. Do refs cross stems and epochs? Decision: stem reads (`get`), issuing branch writes; epoch fold terminates all.
7. Is each ref call an at-time function? Decision: yes; no inferred scheduled follow-up.
8. Who decides descriptor elision? Decision: policy flag backed by preface hash in the session record; unknown hash appends.
9. Does the query surface restrict models (CLAUDE.md)? Decision: the declared set is the mechanism; narrowing it is policy, an option off by default.
10. Q4 (README) stays open; the staged-intent projection reading is added as a case, not a resolution.

## Survey, deferred (coarse pass not run; budget not spent)
S-Q1 Prior art for server-declared next actions (hypermedia controls, capability references): do they bound lifetime, and how do they treat names from untrusted content?
S-Q2 Prior art on marking truncated or summarized content to a model consumer, and on rarity-biased selection as an injection vector.
