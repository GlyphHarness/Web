# Contracts and protocol-first (A1, A2)

Status: hypothesis. Built: nothing.

## Terms
platform contract, core contract set, direct binding, wasm component, protocol-first, document fetch (see catalog/inbox/platform-ruvhoq.jsonl).

## PH1 wasm-direct binding (hjltjz)
Claim: a wasm component uses every platform feature through a contract stated as data, no JavaScript layer between.
Contract record (shape, hypothesis): id, version, operations[{name, in, out, errors}], types, time fields (which args carry timestamps), binding kinds allowed.
Holds if: one feature (clock) is bound by two different implementations (native, wasm) from the same record with equal results on the same inputs; and a call crosses no JS value.
Replaces: JS API surfaces (Web IDL objects) as the only door to features.
Cost: a binding generator or interpreter per binding kind; contract versioning.

## PH2 core contract set (qrlozs)
Claim: six contracts suffice to start:
1. clock: now, timestamp rule read (feeds time.md).
2. stream: bytes in/out bound to a platform protocol (feeds protocols.md).
3. store: keyed state with versions (feeds state timeline, cache).
4. surface: nodes, look, draw (feeds look.md).
5. module: load, instantiate, link wasm components; the only door for code.
6. identity: principal, delegations, provenance (feeds trust.md).
Holds if: a small app (text, input, fetch a document, draw, persist) is expressible with only these; each feature a browser app needs beyond them is listed with the contract it would add.
Replaces: the implicit set of hundreds of web APIs.
Cost per addition: one record, bindings in every implementation, a version line, a threat entry in trust.md.
Not in the six, on purpose: threads/workers (module + stream instead), storage quotas (store policy data), media, permissions UI (identity), accessibility tree (surface; likely needed early, flagged).

## PH3 protocol-first app (cvycil)
Claim: every exchange names a platform protocol; a page fetch is the document protocol among others; no ambient fetch/XHR/WebSocket.
Holds if: the app fetches a page, a REST query and a stream using only stream contract calls that name protocol ids; omitting the id resolves to the catalog default (PH4).
Replaces: ambient request APIs where protocol is implicit in the URL scheme and headers.
A2 reading: the app could present a fetched page but it is not an HTML document host; it speaks its own protocols; head metadata and SEO are not design inputs (Q7).
Cost: every ingress needs a protocol record; no free-form requests.

## Kept (rejected, not tried; reasoning only)
- JS shim that wraps contracts as JS objects: rejected, it is the binding path the goal removes; allowed only as an edge adapter for a browser host (Q2), never as the definition.
- Contract as an IDL in prose: rejected, must be data so defaults and catalogs can read it.
- One big capability API: rejected, violates smallest set first.

## Open
- Binding kinds: how a wasm component calls a native implementation without a JS hop (embedder only, Q2).
- Prior art on contracts-as-data for wasm (component model interface types, WIT) exists in memory, unverified; later survey pass (not in the A3/A5-A7 pass).
