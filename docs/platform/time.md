# Time (A5, A6)

Status: hypothesis. Built: nothing. Evidence: docs/platform/survey-A3-A5.md and docs/platform/explored-A3-A5.jsonl (S5.x), docs/platform/survey-A6-A7.md and docs/platform/explored-A6-A7.jsonl (S6.x); coarse, 2026-11-21. Names not covered there are from memory and marked unverified.

## Terms
event record, event transition, state timeline, as-of read, event queue, timestamp rule, epoch pin, due comparison, at-time function, scheduled function, run trace, trace guard, trace projection, knockout.
Existing overlaps (link, no duplicate): flow lint knilmc (timestamped, state-attributed records, never rewritten; same discipline); projection gwokxx and transition gate tsbyvc (flow state machine; different layer); handle/resolve/warp swhuvh qdfcuf kwxvzl (a handle resolved at a time resembles an as-of read); guard xblxxs (flow guard rejoins a strand; trace guard knocks out).

## A5 data shapes (hypothesis)
- event record: id, source, start, transitions[{t, kind, data?}], payload, rule (timestamp rule id). Immutable, append-only.
- state timeline: store contract keeps versions {key, at, value, by (run id)}; never overwritten.
- as-of read: read(key, at) -> the version with the greatest at <= given timestamp.
- timestamp rule (catalog record): unit, clock (wall epoch | monotonic + offset), epoch origin, tie order (source id, then sequence), resolution. Not a constant in code.
- event queue: records ordered by (start, tie order); consumed against intervals (A6).

## PH11 event records (dgtcqd)
Claim: input and events as immutable records with start, transitions and payload carry all a handler needs.
Holds if: a press-drag-release gesture is one record; a handler built only from the record plus as-of reads reproduces the live outcome on replay; the same shape serves flow-lint events (knilmc) with no extra fields.
Replaces: transient callback events with a current-time clock and ambient mutable state.
Cost: records stored until retention data says drop; every source must stamp times (clock contract).

## PH12 as-of state read (gsioti)
Claim: a handler that reads state only as-of its event's timestamp gives the same result when replayed later.
Holds if: replaying a recorded session (records + timeline) yields identical outputs, including under late-arriving events reordered by timestamp.
Replaces: reads of current state in handlers (order-dependent results).
Cost: memory for all versions; retention and compaction as data; late arrivals force re-evaluation of later runs (see PH15, Q6).

## A6 scheduling (hypothesis)
- due comparison: item due when ts <= now (queue's now, from the clock contract). No timers.
- epoch pin: interval n; ticks at k*n where k = floor(epoch / n); first tick = the next multiple, not "n after start". Two functions with intervals sharing a divisor align.
- catch-up policy (data): skip | coalesce | run-all when ticks were missed.
- jitter (data, optional): spreads ticks of many instances to avoid synchronized load.

## PH13 epoch-pinned scheduling (vsbder)
Claim: intervals pinned to floored epoch multiples plus a timestamp-compared queue schedule work without timers and align ticks across functions.
Holds if: N functions with intervals 1s, 5s, 60s run on shared boundaries; after a long stall the catch-up policy yields the documented ticks; two instances started at different moments tick on the same grid.
Replaces: setInterval-style drift from start time.
Cost: aligned ticks synchronize load (jitter option); depends on epoch definition (leap seconds, clock steps) in the timestamp rule.

## PH14 at-time and scheduled functions (tllxhx)
Claim: every function is at-time (one timestamp) or scheduled (pinned ticks), and the kind alone fixes how it is replayed.
Observation (hypothesis): a scheduled function is an at-time function plus an epoch-pinned trigger, so replaying it is replaying the at-time function at each tick.
Holds if: a scheduled function replays from its tick list with no hidden state; an at-time function called at t1 and t2 differs only by as-of reads.
Replaces: ad hoc timers with captured mutable state.
Cost: functions must keep outputs and effects declared (effect contract with delegation, trust.md).

## PH15 trace guard knockout (mtcgpe, supersedes vjdkxo, fgsoab, gdhqxh)
Claim: a trace guard over a projection of a run trace, when it fails, knocks out the downstream runs that depended on it, bounded by early cutoff (yhmcoe: a re-run with an unchanged output hash stops propagation; survey-A6-A7.md S6.2, rustc red-green). "Exactly" is dropped: cutoff may spare a dependent whose output is unchanged.
Data:
- run trace: run id, fn, kind, at or tick, reads[{key, as_of, version}], writes, outputs, verdicts.
- dependency: run B depends on run A if B read a version A wrote (so dependency is derived from reads, not declared).
- trace projection: which trace fields and times one guard looks at (a view, not a copy).
- knockout: dependents are not run if pending, marked void if already run; voided writes are tombstoned in the timeline (not deleted; append-only). In-app state only; external effects follow the effect declaration below.
Holds if: a failed guard on run A voids B and C (read A's writes, outputs changed) and leaves D (read other data) intact, and a dependent whose re-run output hash is unchanged is not voided, shown from the traces alone; the guard sees only its projection.
Replaces: exception unwinding and manual cache invalidation after a bad step.
Cost: dependency graph from traces; effect handling below (Q6).
Decided (Q4, 2026-11-21, platform's call): a trace guard reads a projection of a run trace, a view over fields and times of one trace. The guard is a predicate on that view; it does not project what should follow.
Decided (Q6, 2026-11-21, platform's call, operator suggestion adopted): knockout voids only in-app derived state (runs, timeline versions by tombstone, outputs). An effect that already left the app (message sent, payment made) is irreversible and is never voided. An effect record may declare one of:
- guarded: released only after its guard clears, so knockout precedes release;
- compensated: a compensating action (named in the record, with its delegation) is recorded and runs on knockout;
- final: declared non-voidable; release has no guard (the author owns that).
Hypothesis: the declaration is a field of the effect record. Default: an effect without one is recorded as undeclared and treated as final. Rejecting an undeclared effect with a named error is an option, off by default (CLAUDE.md: restrictions are options). Holding is the behavior of "guarded" only; there is no global hold. A compensation is its own run with its own trace.
Check: from traces alone, a failed guard on A leaves a guarded effect unreleased, runs the compensation of a compensated one once, and leaves a final one untouched.
Cost: authors classify effects (undeclared means final); "guarded" delays effects by guard latency; compensations can fail (unproven that all effects have one; a sent message has none, so it is guarded or final).

## Kept (rejected, reasoning only)
- Wall-clock timers per function: rejected; drift, DST and clock steps. Epoch grid is calculable.
- Mutating state with last-writer-wins: rejected; no as-of reads possible.
- Q4 alternate reading, a guard projects what should follow and compares it to what occurred (gwokxx style): dropped; one data shape is enough, a mismatch check can still be a predicate over the view.
- Knockout voiding effects already external (undo a sent message): rejected as impossible; effects are guarded, compensated or final.
- Declared dependencies between runs: rejected for the base; reads-derived dependencies cannot be forgotten. May add declared ones as an option.
- Timestamps as floats of local time: rejected; the timestamp rule says unit and origin.

## Survey questions
A5 (budget 3 sources):
S5.1 How do browsers stamp input today: clock and origin of event timestamps (candidates, unverified: DOMHighResTimeStamp, Event Timing, coalesced and predicted pointer events), timer resolution limits (coarsened for side-channel defense), and does any event carry per-transition times? Answer: what exists, resolution, gap versus an event record.
S5.2 Prior art and cost of as-of reads: temporal and bitemporal databases, event sourcing, persistent data structures (candidates, unverified: SQL:2011 temporal tables, Datomic as-of, XTDB). Which gives cheap as-of for key-value state, and what do they report on storage growth and compaction?
S5.3 Clock choice: wall epoch versus monotonic for event ordering; skew and step behavior; any recommended practice for ordering distributed events by timestamp (hybrid logical clocks?). One answer with source.
A6 (budget 3 sources):
S6.1 Prior art for epoch-aligned intervals: cron semantics, tumbling windows in stream processors, timing wheels; documented pitfalls (missed ticks, leap seconds, clock steps, aligned load spikes) and standard catch-up policies.
S6.2 Prior art for dependency-driven knockout: build systems and incremental computation (early cutoff), reactive dataflow glitch-freedom, sagas and compensation, truth maintenance. What do they say about voiding downstream work, and about external effects that cannot be undone?
S6.3 Is there precedent for the at-time versus scheduled split (candidates, unverified: functional reactive programming behaviors versus events; workflow engines with replay)? One source; report names only.
Defer: distributed time, CRDTs, hardware timers.
