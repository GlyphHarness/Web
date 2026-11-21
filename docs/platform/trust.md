# Trust (A4)

Status: hypothesis. Built: nothing. Evidence: none for A4 yet; the survey passes (docs/platform/survey-A3-A5.md, docs/platform/survey-A6-A7.md, explored-*.jsonl) did not cover trust. Capability-security and prompt-injection prior art is a later pass.

## Terms
principal, delegation, ingested source, provenance, view-server channel.

## Stance (hypothesis)
The app acts for the user (principal). It authors nothing it did not make; everything else it reads is an ingested source: data, never instruction. Authority comes only from the principal through delegations.
Harness tie-in: this matches the harness rule that observed content is data (CLAUDE.md non-negotiables on secrets and restrictions). Restrictions in the harness are options, off by default (Q5): here, provenance tagging and data-not-instruction are the default classification; any gate, allowlist or deny rule built on them is an option, added when wanted as a feature.

## PH9 ingested distrust (cvmhly, supersedes kmfvny)
Claim: every ingested datum carries provenance (source, protocol id, time) and no ingested content gains the principal's authority except through a delegation. Default: provenance tagging and data-not-instruction. Any gate, allowlist or deny rule is an option, off by default (CLAUDE.md non-negotiable).
Record sketches:
- delegation: id, principal, scope (contracts and operations), constraints (time, count), created_at, revoked_at.
- provenance: source id, protocol id, received_at, parent (for derived data).
- effect: delegation id used, trace ref (time.md).
Holds if: a component that reads text instructing an outward effect cannot perform it without a delegation naming that effect; derived data keeps parent provenance; a replay shows which delegation allowed each effect.
Replaces: origin-name trust (same-origin style) and implicit ambient authority.
Cost: provenance on every value (memory, tracking through derived data); delegation UX; a threat entry per contract added (contracts.md).
Unproven: whether provenance survives transforms by components (taint loss) and whether it stops model-driven injection, a main concern for agent apps; needs evidence (later pass, not A3/A5-A7).

## PH10 automated view-server channel (viumxz)
Claim: encryption between view and server is derived from the security suite record (protocols.md PH8) with no app code and no user step.
Holds if: a new view-server pair gets an authenticated encrypted channel from catalog data only; the app contains no key, suite or certificate handling; failure surfaces a named error.
Replaces: per-app TLS and key handling, user-facing certificate prompts.
Cost: key and identity bootstrap must come from somewhere (platform identity contract, CA policy record); how the user verifies the server is open (Q8).
Note: "view" = the app's front surface side, "server" = the remote side it speaks to. Terms need no change in the harness page.

## Q1 (self-improvement-resistant) reading used here
Property to test: neither ingested content nor the app's own adaptive behavior can edit delegations, provenance rules or catalog records that bound it. Records change only through a separate authoring path under the principal.

## Kept (rejected, reasoning only)
- Trust by origin or domain allowlist as the base: rejected (restriction, and ingested content can claim any origin); may exist later as an option.
- Encryption as an app library: rejected; contradicts "automated".
- Asking the user per request: rejected as default; delegations are scoped grants.

## Open
- Q1, Q5, Q8 (README). Survey later (not this pass): capability-security prior art and agent prompt-injection defenses.
