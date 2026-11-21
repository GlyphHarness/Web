# Protocol catalog (A3)

Status: hypothesis. Built: nothing. Threat model (PH18, operator answer 2026-11-21): RSI-grade adversary. Evidence: docs/platform/survey-A3-A5.md and docs/platform/explored-A3-A5.jsonl (coarse, 2026-11-21: RFC 10024, RFC 9111 4.4, DPV); names below not covered there are from memory and marked unverified.

## Terms
platform protocol, protocol catalog, protocol layer, default protocol, enumerated invalidation, enumerable result set, regulatory protocol, security suite, RSI-grade adversary.
"protocol" in catalog/ otherwise means docs/PROTOCOL.md (harness) or flow protocol; here always "platform protocol".

## Shape (hypothesis)
Protocol record: id, layer (transport | security | exchange | cache | regulatory), version, params (typed), requires (other ids), default_for (layer or kind or null), status.
Exchange: names at most one protocol per layer. Omitted layer -> record with default_for matching, chosen from catalog data. No default found -> the exchange fails closed with a named error; no fallback in code.
Catalog is data loaded through the store contract; pluggable = add or supersede a record (append-only, like catalog/*.jsonl). Lists (which suites, which laws) are records, not constants.

## PH4 protocol catalog (ghttaf)
Claim: protocols are data records; adding one adds a protocol; omitted protocol resolves to the catalog default per layer.
Holds if: swapping the default transport record (tcp stream -> a second record) changes behavior with no change to app or platform code; and removing all defaults yields the named error, not a silent choice.
Replaces: URL scheme plus hard-coded stack.
Cost: every call resolves through the catalog; catalog trust (Q8).

## PH5 enumerated invalidation (ydsgja)
Claim: a cache drops chosen members by enumeration; the rest stay valid.
Needs PH6. Invalidation message: cache protocol id + list of member ids (or a result-set id + enumeration range).
Holds if: after a write touching k of n cached members, k entries drop, n-k stay, with no whole-cache purge and no time guess; correctness check against a full refetch.
Replaces: whole-cache purge, TTL-only expiry, header heuristics.
Cost: server must emit or accept member ids; cache keeps member index; ordering vs timestamps (time.md).

## PH6 enumerable result set (mvfezw)
Claim: a query result lists its members by stable id with count and cursor; REST-style queries return such sets.
Holds if: the same query paged through yields the same member list as the enumeration; ids stable across pages and re-queries until a recorded change.
Replaces: opaque response bodies and offset paging drift.
Cost: stable ids from the server; deletions need tombstones or version stamps.

## PH7 regulatory protocol records (eeroue)
Claim: privacy-law and data-security rules (GDPR, US federal and state rules, sector rules) are records evaluated as checks on exchanges; a jurisdiction change is a data change.
Record sketch: id, jurisdiction, applies_when (data kind, principal region, purpose), checks (consent present, retention, transfer region, minimization), outcome (allow, deny, require delegation).
Holds if: the same exchange yields different documented outcomes under two rule records with no code change, and each outcome names the record and clause.
Replaces: scattered compliance code.
Cost: legal content authored and kept current by someone (Q8); data is not legal advice; mapping rules to checks loses nuance. Unproven: whether laws can be reduced to checks usefully.

## PH8 security suite records (lojtwn)
Claim: TLS versions, key exchange and signature suites (including post-quantum or hybrid) and CA handling are records; algorithm agility needs no code change.
Record sketch: id, tls_version, kex[], sig[], cipher[], pq_mode (none | hybrid | pq-only), ca_policy (trust store source, pinning, revocation, transparency), min_version.
Holds if: enabling a hybrid post-quantum suite or tightening the CA policy is a catalog change only, and downgrade is refused by the record's min values.
Replaces: library defaults hidden in a runtime.
Cost: the crypto implementation still lives in the platform; records choose, they do not implement. Wrong records weaken security, so catalog write rights matter (Q8). Threat model: RSI-grade adversary (PH18); agility and hybrid modes follow from it.

## PH18 RSI-resistant surfaces (wkpcau; Q1 answered 2026-11-21)
Meaning (operator): resistant to a recursively self-improving (RSI) intelligent agent with high-level cryptographic solving and exploiting ability that breaks or exploits our system easily (RSI-grade adversary, hnqzly). Not "records the app cannot edit".
Claim: if every protocol, trust and look surface is designed assuming that adversary, no single broken primitive or leaked secret defeats the platform alone.
Consequences (hypothesis):
- Do not rely on one primitive's secrecy or hardness: records may name more than one kex and sig (hybrid), so one break does not decide.
- Agility: swapping a suite is a record change (PH8); the platform assumes any suite may be broken later.
- Post-quantum: hybrid or pq-only modes are first-class records, not later additions; downgrade is refused by min values.
- No security through obscurity: nothing depends on hidden formats, unpublished records or a secret design; secrets are keys only.
- Restrictions stay options, off by default (CLAUDE.md): the baseline is cryptographic design and provenance (trust.md); gates, allowlists and deny rules are added when wanted as features.
Holds if: with any one suite record in a hybrid pair marked broken, the exchange still meets its record's security claim or refuses with a named error; no design note or contract depends on a secret other than keys.
Replaces: a single-library, single-suite, trust-the-runtime stance.
Cost: more records and larger handshakes; each added primitive is more implementation to keep correct; options (gates) wait for a feature wish. Unproven: what a cryptographically strong RSI adversary can still do to implementation bugs (side channels, memory safety) that suite records do not cover; the platform's own code stays an attack surface.

## Kept (Q1)
- Reading (a), "records the app cannot edit": not the meaning. Its property (changes to catalog, delegation and provenance rules only through a separate authoring path under the principal, Q8) stays as one consequence to test in trust.md, not as the definition.

## Kept (rejected, reasoning only)
- Defaults in code "for safety": rejected by directive; fail closed with a named error instead.
- Protocol picked from URL scheme: rejected; implicit, not enumerable.
- Whole-cache purge as the primary path: kept only as a degenerate enumeration (all members).

## Survey questions (A3; budget 3 sources; coarse; one area)
S3.1 Post-quantum transport status in 2026: which hybrid key exchange (candidates from memory, unverified: X25519 with ML-KEM-768) is default in major browsers and servers; are PQ certificate signatures (ML-DSA) deployed or only planned (CA/Browser Forum, root program stance)? Answer: name, status, date, source.
S3.2 Closest existing prior art for partial invalidation by enumeration and enumerable result sets (candidates, unverified: HTTP cache RFC 9111 and Cache-Status, CDN purge by tag or surrogate key, the HTTP QUERY method, cursor connections in JSON:API or GraphQL). Which actually invalidate by listing members, and what do they need from the server?
S3.3 Machine-readable privacy rules: is there a settled vocabulary (candidates, unverified: W3C DPV, ODRL, Global Privacy Control) and how far does it go for GDPR and US state laws? Answer: exists / partial / none, with source.
S3.4 Closed: Q1 answered 2026-11-21 (RSI-grade adversary, PH18). Optional later, not requested: literature on cryptographic and implementation security against AI-automated attack.
Defer: QUIC/HTTP3 detail, UDP security, CA transparency internals.
