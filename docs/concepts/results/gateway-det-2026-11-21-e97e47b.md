# Gateway core, deterministic measurements (2026-11-21, e97e47b, head e97e47b447472b3f40acd477bdb6b75d72a03c68)

Script `scripts/measure-gateway.mjs`, core `app/claude-gateway.js` (sha256 0c391f310be37e03, repo head e97e47b). Synthetic streams and bodies from a seeded PRNG; no network, no model, no key. Full JSON: `docs/concepts/results/gateway-det-2026-11-21-e97e47b.json`. Hypotheses: `docs/platform/claude-route-survey.md` (R-numbers). Timing is wall clock on one machine (win32 x64, node v24.1.0), indicative only; counts, sweeps and hashes are deterministic.

**Checks run: 1035091, failed: 0.** Determinism: two full runs, hash equal (0b1aebbdee1d3cac). Halt sweep points: 86776 single-budget plus 2240 combined-budget trials plus 72 corner budgets. Credential canary: 816 probes, 0 leaks.

## Streams

| stream | kind | payload chars | events | sha256 (SSE bytes) |
| --- | --- | --- | --- | --- |
| text-1K | text | 1024 | 50 | d01cb327715d8c4b |
| mixed-1K | mixed | 1024 | 55 | 687bc7fc80000f5f |
| longthink-1K | longthink | 1024 | 60 | 5bc69a8ecb3b14a6 |
| small-1K | small | 1024 | 1025 | ee26a185ee734f4d |
| small-10K | small | 10240 | 10241 | 3a0ddd2268272374 |
| text-100K | text | 102400 | 4338 | 822d1546899ccd60 |
| mixed-100K | mixed | 102400 | 4285 | 15cfaa4864e20f0b |
| longthink-100K | longthink | 102400 | 4276 | 5631ea583cf4e6e5 |
| small-100K | small | 102400 | 102401 | 3d71324d5f5bc8da |
| text-1M | text | 1048576 | 43870 | f6305c2252fb1840 |
| mixed-1M | mixed | 1048576 | 43785 | 8bf37eb6f31c2117 |
| longthink-1M | longthink | 1048576 | 43692 | 12cc1ec5a7ff13b7 |

## Halt-and-alter sweep (R4, R5 counters, R14 shape, R17)

Per point: abort at the oracle index (budget first reached; the cut waits for an open tool_use block on both listeners and for an open thinking block on the Claude Code listener), reason code, delivered head is the original prefix by object identity, tail is exactly the closer of the open block, one `message_delta` with the policy stop reason, `message_stop`, token estimate = ceil(chars/4), counters equal the recount, swallow after halt, no tool_use cut, no thinking cut on the Claude Code listener, snapshot trial equals from-scratch run on sampled points. Wait events = events between the delta that reaches the budget and the abort (0 when the block may be cut).

| stream | events | stride | cc points | cc max wait | harness points | harness max wait |
| --- | --- | --- | --- | --- | --- | --- |
| text-1K | 50 | 1 (exhaustive) | 176 | 0 | 176 | 0 |
| mixed-1K | 55 | 1 (exhaustive) | 145 | 13 | 145 | 6 |
| longthink-1K | 60 | 1 (exhaustive) | 180 | 41 | 180 | 2 |
| small-1K | 1025 | 1 (exhaustive) | 1780 | 359 | 1780 | 122 |
| small-10K | 10241 | 3 | 5994 | 3585 | 5994 | 1274 |
| text-100K | 4338 | 3 | 5718 | 0 | 5718 | 0 |
| mixed-100K | 4285 | 1 (exhaustive) | 14812 | 1489 | 14812 | 538 |
| longthink-100K | 4276 | 2 | 8401 | 3828 | 8401 | 40 |
| small-100K | 102401 | 224 | 830 | 35841 | 830 | 12794 |
| text-1M | 43870 | 257 | 698 | 0 | 698 | 0 |
| mixed-1M | 43785 | 41 | 3761 | 15295 | 3761 | 5541 |
| longthink-1M | 43692 | 206 | 893 | 39296 | 893 | 434 |

| check | run | fail |
| --- | --- | --- |
| stream-well-formed | 12 | 0 |
| stream-one-open-block | 12 | 0 |
| one-abort | 89911 | 0 |
| abort-at-oracle | 89911 | 0 |
| reason | 89911 | 0 |
| state-done | 89911 | 0 |
| head-is-original-prefix | 89911 | 0 |
| tail-shape | 89911 | 0 |
| token-estimate | 89911 | 0 |
| counters-equal-recount | 89911 | 0 |
| no-tool-use-cut | 89911 | 0 |
| no-thinking-cut-claude-code | 44964 | 0 |
| swallow-after-halt | 89911 | 0 |
| delivered-well-formed-sample | 86776 | 0 |
| snapshot-equals-from-scratch | 1868 | 0 |
| no-policy-is-identity | 24 | 0 |
| no-halt-when-unreached | 185 | 0 |
| error-passes-untouched | 51 | 0 |
| req-input-untouched | 54 | 0 |
| req-count | 54 | 0 |
| req-survivors-were-markers | 54 | 0 |
| req-system0-byte-equal | 54 | 0 |
| req-content-unchanged | 54 | 0 |
| req-idempotent | 54 | 0 |
| req-lattice-messages-oldest-first | 54 | 0 |
| req-lattice-system-after-messages | 54 | 0 |
| req-lattice-tool-last | 54 | 0 |
| req-system0-marker-kept | 54 | 0 |
| req-applied-named | 54 | 0 |
| req-thinking-clamped | 54 | 0 |
| req-no-policy-same-object | 54 | 0 |
| req-string-forms-kept | 1 | 0 |
| prefix-content-byte-identical | 3 | 0 |
| prefix-idempotent | 3 | 0 |
| prefix-prev-newest-marker-survives | 3 | 0 |
| prefix-at-most-four-markers | 3 | 0 |
| canary-clean | 812 | 0 |
| harness-client-credential-not-forwarded | 5 | 0 |
| harness-own-key-only-in-x-api-key | 5 | 0 |
| harness-forwards-allowlist-and-own-key-only | 5 | 0 |
| harness-drops-every-other-client-header | 5 | 0 |
| harness-allowlisted-values-carried-by-reference | 5 | 0 |
| harness-header-count-is-allowlisted-plus-one | 5 | 0 |
| claude-code-listener-blind-copy-in-order | 5 | 0 |
| harness-no-key-fails-closed | 35 | 0 |
| r18-guarded-values-never-read | 1 | 0 |
| request-body-text-carried-not-moved | 6 | 0 |
| static-module-state | 1 | 0 |
| rd-harness-text-and-thinking | 1 | 0 |
| rd-claude-code-text-only | 1 | 0 |
| rd-claude-code-thinking-objects-identical | 1 | 0 |
| rd-signature-and-tool-untouched | 1 | 0 |
| rd-counters-count-upstream | 1 | 0 |
| rd-alter-verdict-only-when-changed | 1 | 0 |
| rd-well-formed | 1 | 0 |
| rd-thinking-reducer-never-called-on-claude-code | 1 | 0 |
| rd-kind-index-args | 1 | 0 |
| rd-compose-in-order | 1 | 0 |
| rd-identity-no-alter-no-new-objects | 1 | 0 |
| rd-nonstring-ignored | 1 | 0 |
| rd-budget-on-upstream-counts | 1 | 0 |
| rd-sse-round-trip | 1 | 0 |
| rd-registry-refusals | 1 | 0 |
| codec-round-trip | 8 | 0 |
| codec-random-chunks-lf | 8 | 0 |
| codec-random-chunks-crlf | 8 | 0 |
| codec-every-two-chunk-cut-lf | 1 | 0 |
| codec-byte-at-a-time-lf | 1 | 0 |
| codec-every-two-chunk-cut-crlf | 1 | 0 |
| codec-byte-at-a-time-crlf | 1 | 0 |
| codec-comments-skipped | 1 | 0 |
| codec-data-without-space | 1 | 0 |
| codec-multiline-data-joined | 1 | 0 |
| codec-bad-json-reported | 1 | 0 |
| codec-event-only-frame-skipped | 1 | 0 |
| codec-non-object-frame-goes-to-bad-null | 1 | 0 |
| codec-non-object-frame-goes-to-bad-number | 1 | 0 |
| codec-non-object-frame-goes-to-bad-array | 1 | 0 |
| codec-non-object-frame-goes-to-bad-string | 1 | 0 |
| codec-non-object-frame-goes-to-bad-true | 1 | 0 |
| codec-non-object-frame-does-not-drop-neighbours | 1 | 0 |
| fz-stream-throws-classed | 1 | 0 |
| fz-admit-matches-model | 1 | 0 |
| admit-wrong-shape-400-bad-request | 30 | 0 |
| headers-wrong-shape-400-bad-headers | 18 | 0 |
| harness-key-checked-before-headers | 1 | 0 |
| fz-no-throw-anywhere | 1 | 0 |
| onrequest-non-object-body-returned-as-given | 7 | 0 |
| fault-fhkyrn-streamstep-null-passes-through | 1 | 0 |
| fault-fhkyrn-sse-null-frame-is-bad | 1 | 0 |
| fault-trbwvd-onrequest-null-body-unchanged | 1 | 0 |
| fault-trbwvd-onrequest-messages-object-no-throw | 1 | 0 |
| fault-trbwvd-nonobject-last-tool-no-throw | 1 | 0 |
| fault-trbwvd-last-tool-string-nothing-moves | 1 | 0 |
| fault-trbwvd-admit-null-400 | 1 | 0 |
| fault-trbwvd-pass-and-harness-headers-null-400 | 1 | 0 |
| fault-mkqsxn-harness-forward-is-allowlist | 1 | 0 |
| fault-mkqsxn-cookie-and-proxy-authorization-dropped | 1 | 0 |
| claude-code-listener-drops-only-hop-headers | 1 | 0 |
| nonobject-event-passes-through-state-unchanged | 180 | 0 |
| nonobject-event-stream-continues-to-same-final-state | 180 | 0 |

## Per-event overhead (indicative)

Timer overhead per call 0.115 us (not subtracted).

| stream | events | listener | policy | us/event | events/s |
| --- | --- | --- | --- | --- | --- |
| text-1K | 50 | claude-code | pass-through (no policy) | 0.702 | 1424502 |
| text-1K | 50 | claude-code | budget set, never reached | 0.724 | 1381214 |
| text-1K | 50 | claude-code | text reducer | 1.15 | 869565 |
| text-1K | 50 | claude-code | text and thinking reducers + budget | 1.188 | 841750 |
| text-1K | 50 | harness | pass-through (no policy) | 0.636 | 1572325 |
| text-1K | 50 | harness | budget set, never reached | 0.708 | 1412428 |
| text-1K | 50 | harness | text reducer | 1.142 | 875658 |
| text-1K | 50 | harness | text and thinking reducers + budget | 1.176 | 850340 |
| mixed-1K | 55 | claude-code | pass-through (no policy) | 0.567 | 1762818 |
| mixed-1K | 55 | claude-code | budget set, never reached | 0.633 | 1580463 |
| mixed-1K | 55 | claude-code | text reducer | 0.798 | 1252847 |
| mixed-1K | 55 | claude-code | text and thinking reducers + budget | 0.807 | 1238739 |
| mixed-1K | 55 | harness | pass-through (no policy) | 0.682 | 1466666 |
| mixed-1K | 55 | harness | budget set, never reached | 0.731 | 1368159 |
| mixed-1K | 55 | harness | text reducer | 1.082 | 924370 |
| mixed-1K | 55 | harness | text and thinking reducers + budget | 1.667 | 599782 |
| longthink-1K | 60 | claude-code | pass-through (no policy) | 0.563 | 1775154 |
| longthink-1K | 60 | claude-code | budget set, never reached | 0.642 | 1558444 |
| longthink-1K | 60 | claude-code | text reducer | 0.628 | 1591515 |
| longthink-1K | 60 | claude-code | text and thinking reducers + budget | 0.593 | 1685396 |
| longthink-1K | 60 | harness | pass-through (no policy) | 0.595 | 1680674 |
| longthink-1K | 60 | harness | budget set, never reached | 0.663 | 1507540 |
| longthink-1K | 60 | harness | text reducer | 0.643 | 1554401 |
| longthink-1K | 60 | harness | text and thinking reducers + budget | 0.888 | 1125703 |
| small-1K | 1025 | claude-code | pass-through (no policy) | 0.546 | 1830357 |
| small-1K | 1025 | claude-code | budget set, never reached | 0.65 | 1537423 |
| small-1K | 1025 | claude-code | text reducer | 0.732 | 1366484 |
| small-1K | 1025 | claude-code | text and thinking reducers + budget | 0.775 | 1290444 |
| small-1K | 1025 | harness | pass-through (no policy) | 0.625 | 1600062 |
| small-1K | 1025 | harness | budget set, never reached | 0.68 | 1469534 |
| small-1K | 1025 | harness | text reducer | 0.768 | 1301587 |
| small-1K | 1025 | harness | text and thinking reducers + budget | 0.815 | 1226957 |
| small-10K | 10241 | claude-code | pass-through (no policy) | 0.573 | 1745109 |
| small-10K | 10241 | claude-code | budget set, never reached | 0.79 | 1265415 |
| small-10K | 10241 | claude-code | text reducer | 0.757 | 1320227 |
| small-10K | 10241 | claude-code | text and thinking reducers + budget | 0.843 | 1186441 |
| small-10K | 10241 | harness | pass-through (no policy) | 0.61 | 1638848 |
| small-10K | 10241 | harness | budget set, never reached | 0.755 | 1324530 |
| small-10K | 10241 | harness | text reducer | 0.91 | 1098879 |
| small-10K | 10241 | harness | text and thinking reducers + budget | 1.101 | 908647 |
| text-100K | 4338 | claude-code | pass-through (no policy) | 0.726 | 1376924 |
| text-100K | 4338 | claude-code | budget set, never reached | 0.728 | 1372828 |
| text-100K | 4338 | claude-code | text reducer | 1.554 | 643410 |
| text-100K | 4338 | claude-code | text and thinking reducers + budget | 1.64 | 609655 |
| text-100K | 4338 | harness | pass-through (no policy) | 0.738 | 1355879 |
| text-100K | 4338 | harness | budget set, never reached | 0.893 | 1119860 |
| text-100K | 4338 | harness | text reducer | 1.735 | 576440 |
| text-100K | 4338 | harness | text and thinking reducers + budget | 1.705 | 586430 |
| mixed-100K | 4285 | claude-code | pass-through (no policy) | 0.715 | 1399229 |
| mixed-100K | 4285 | claude-code | budget set, never reached | 0.695 | 1439175 |
| mixed-100K | 4285 | claude-code | text reducer | 0.825 | 1212713 |
| mixed-100K | 4285 | claude-code | text and thinking reducers + budget | 1.053 | 949753 |
| mixed-100K | 4285 | harness | pass-through (no policy) | 0.736 | 1357903 |
| mixed-100K | 4285 | harness | budget set, never reached | 0.848 | 1179466 |
| mixed-100K | 4285 | harness | text reducer | 1.125 | 888525 |
| mixed-100K | 4285 | harness | text and thinking reducers + budget | 1.281 | 780354 |
| longthink-100K | 4276 | claude-code | pass-through (no policy) | 0.773 | 1293562 |
| longthink-100K | 4276 | claude-code | budget set, never reached | 0.801 | 1248577 |
| longthink-100K | 4276 | claude-code | text reducer | 1.227 | 815284 |
| longthink-100K | 4276 | claude-code | text and thinking reducers + budget | 1.485 | 673449 |
| longthink-100K | 4276 | harness | pass-through (no policy) | 1.334 | 749886 |
| longthink-100K | 4276 | harness | budget set, never reached | 1.577 | 634139 |
| longthink-100K | 4276 | harness | text reducer | 1.676 | 596723 |
| longthink-100K | 4276 | harness | text and thinking reducers + budget | 1.268 | 788697 |
| small-100K | 102401 | claude-code | pass-through (no policy) | 0.81 | 1234293 |
| small-100K | 102401 | claude-code | text and thinking reducers + budget | 0.929 | 1076096 |
| small-100K | 102401 | harness | pass-through (no policy) | 0.819 | 1220515 |
| small-100K | 102401 | harness | text and thinking reducers + budget | 1.285 | 778425 |
| text-1M | 43870 | claude-code | pass-through (no policy) | 0.776 | 1288778 |
| text-1M | 43870 | claude-code | text and thinking reducers + budget | 1.73 | 578055 |
| text-1M | 43870 | harness | pass-through (no policy) | 0.726 | 1377230 |
| text-1M | 43870 | harness | text and thinking reducers + budget | 1.377 | 726326 |
| mixed-1M | 43785 | claude-code | pass-through (no policy) | 0.762 | 1313102 |
| mixed-1M | 43785 | claude-code | text and thinking reducers + budget | 1.093 | 915143 |
| mixed-1M | 43785 | harness | pass-through (no policy) | 0.719 | 1391069 |
| mixed-1M | 43785 | harness | text and thinking reducers + budget | 1.215 | 822779 |
| longthink-1M | 43692 | claude-code | pass-through (no policy) | 0.625 | 1601137 |
| longthink-1M | 43692 | claude-code | text and thinking reducers + budget | 0.605 | 1651996 |
| longthink-1M | 43692 | harness | pass-through (no policy) | 0.654 | 1529157 |
| longthink-1M | 43692 | harness | text and thinking reducers + budget | 0.976 | 1024994 |

### Per-step latency on mixed-100K, heaviest policy (R14 bound 5 ms at p95)

| listener | events | p50 us | p95 us | p99 us | max us | p95 vs 5 ms |
| --- | --- | --- | --- | --- | --- | --- |
| claude-code | 4285 | 0.8 | 1.7 | 2.1 | 10.6 | 0.034% of 5 ms |
| harness | 4285 | 1.2 | 1.7 | 1.9 | 9.6 | 0.034% of 5 ms |

Codec on mixed-100K (4285 events, 622576 bytes): format 0.97 us/event, split 1.864 us/event (77.945 MB/s).

## Memory across a long stream (indicative)

| listener | events | heap MB samples (after gc) | growth bytes/event | final state JSON bytes |
| --- | --- | --- | --- | --- |
| harness | 2000005 | 42.556 42.536 42.574 42.559 42.488 42.501 42.501 42.5 42.486 42.489 42.489 | -0.028 | 307 |
| claude-code | 2000005 | 42.48 42.496 42.496 42.496 42.496 42.496 42.496 42.496 42.497 42.497 42.497 | 0.001 | 315 |

## Per-request overhead (indicative), median ms per onRequest call

| turns | tools | markers | body KB | no policy | normalise | normalise+thinking |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 0 | 0 | 8 | 0 | 0.164 | 0.4 |
| 10 | 0 | 4 | 8 | 0 | 0.134 | 0.194 |
| 10 | 0 | 8 | 8 | 0 | 0.191 | 0.27 |
| 10 | 50 | 0 | 23 | 0 | 0.622 | 1.394 |
| 10 | 50 | 4 | 23 | 0 | 1.002 | 1.461 |
| 10 | 50 | 8 | 23 | 0 | 1.147 | 1.681 |
| 100 | 0 | 0 | 54 | 0 | 1.229 | 2.681 |
| 100 | 0 | 4 | 54 | 0 | 1.067 | 1.577 |
| 100 | 0 | 8 | 54 | 0 | 1.626 | 2.245 |
| 100 | 50 | 0 | 69 | 0 | 1.557 | 2.326 |
| 100 | 50 | 4 | 69 | 0 | 1.629 | 2.608 |
| 100 | 50 | 8 | 69 | 0 | 1.577 | 2.379 |
| 1000 | 0 | 0 | 517 | 0 | 15.91 | 23.766 |
| 1000 | 0 | 4 | 516 | 0 | 19.621 | 32.924 |
| 1000 | 0 | 8 | 518 | 0 | 22.084 | 40.027 |
| 1000 | 50 | 0 | 532 | 0 | 21.785 | 36.192 |
| 1000 | 50 | 4 | 531 | 0 | 21.143 | 32.434 |
| 1000 | 50 | 8 | 533 | 0 | 20.465 | 32.378 |

Request invariants (54 bodies: 10/100/1000 turns, 0..8 markers, 0 and 50 tools): see the `req-*` checks above.

## Prefix stability over a growing history (R15, deterministic part)

| scenario | turns | raw max markers | normalised max | normalised = raw | content prefix byte-identical failures | marker-inclusive prefix intact / broken | previous newest marker survives |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude-code-like (system 1 + newest and third-newest message, 3 markers) | 400 | 3 | 3 | 399 | 0 | 0 / 398 | 398/398 |
| accumulating (old markers never removed, one more per turn) | 400 | 401 | 4 | 2 | 0 | 1 / 397 | 398/398 |
| early tool marker (tool 0 + newest message) | 400 | 2 | 2 | 0 | 0 | 0 / 398 | 0/0 |

Reading: content prefix = messages, system and tools with cache_control stripped. It is byte-identical across every turn in every scenario. The marker-inclusive prefix (cache_control fields kept) breaks wherever a marker moves, which is expected and not a cache-key claim; whether the provider keys on content only is a live question (R15). Normalisation is the identity on a body with at most 4 markers (claude-code-like, early tool marker moves to the last tool), and changes only the accumulating case (more than 4 markers).

Halt wait, reading: on the Claude Code listener a thinking or tool_use block is never cut, so the abort waits for the block to stop (max wait column, in events); on the harness listener only a tool_use block waits. Within a cuttable block the abort is at the delta that reaches the budget (wait 0).

## Credential blindness (R3, R18)

816 probes over every public function and every input position that takes a string (header values on both listeners, harness key, request paths and methods, request bodies, stream events, thrown errors). Leaks in any returned trace, verdict, state or applied list: 0. Echoes of a caller-supplied identifier in a thrown error message (listener or reducer name, not a header value): 3 (admit.unknown-listener, registerReducer.name, streamInit.unknown-reducer). Module-level mutable state: {"let":[],"containers":["reducers"]}.

## Reducer hook round trip

{"calls":{"textDeltas":19,"thinkingDeltas":12,"alteredHarness":31,"alteredClaudeCode":19},"reducerThrowPropagates":true}

## SSE codec

{"frames":24330,"cutsTried":37559,"jsonNullFrameYieldsEvents":"[]","badFrameOrderRecoverable":"events and bad are returned in separate lists; their relative order is not"}

## Robustness fuzz (seeded)

streams 4000, bodies 4000, admits 12000. Thrown error classes (input minimal as found):

| class | count | minimal input |
| --- | --- | --- |

## Non-object events (fault fhkyrn)

180 injections on mixed-1K: null, 42, "str", [], true and undefined injected at every position near the ends and every 7th in the middle, both listeners; passed through unchanged, state and counters untouched, stream continues to the same final state.

## Fault probes: the minimal inputs of the three recorded faults (mkqsxn, fhkyrn, trbwvd), asserted on this head

```json
{"streamStepNullEvent":{"input":"streamStep(streamInit('harness', {}, {}), null)","threw":false,"result":"{\"state\":{\"listener\":\"harness\",\"class\":null,\"policy\":{\"budget\":{},\"haltStopReason\":\"end_turn\",\"reduce\":[]},\"done\":false,\"halt\":null,\"pending\":null,\"blocks\":{},\"","reachableFrom":"sseSplit('data: null') -> events [], bad 1"},"onRequestNullBody":{"input":"onRequest({}, null, {cache:{normalise:true}})","threw":false,"result":"{\"body\":null,\"applied\":[]}"},"onRequestMessagesNotArray":{"input":"onRequest({}, {messages: {}}, {cache:{normalise:true}})","threw":false,"result":"{\"body\":{\"messages\":{}},\"applied\":[]}"},"onRequestStringToolAfterMarkedTool":{"input":"onRequest({}, {tools:[{name:'a',cache_control},'x'],messages:[]}, normalise)","threw":false,"result":"{\"body\":{\"tools\":[{\"name\":\"a\",\"cache_control\":{\"type\":\"ephemeral\"}},\"x\"],\"messages\":[]},\"applied\":[]}"},"onRequestNullToolAfterMarkedTool":{"input":"onRequest({}, {tools:[{name:\"a\",cache_control},null],messages:[]}, normalise)","threw":false,"result":"{\"body\":{\"tools\":[{\"name\":\"a\",\"cache_control\":{\"type\":\"ephemeral\"}},null],\"messages\":[]},\"applied\":[]}"},"admitNullRequest":{"input":"admit('harness', null)","threw":false,"result":"{\"verdict\":\"reject\",\"status\":400,\"reason\":\"bad-request\"}"},"passHeadersNull":{"input":"passHeaders(null)","threw":false,"result":"{\"verdict\":\"reject\",\"status\":400,\"reason\":\"bad-headers\"}"},"harnessHeadersNull":{"input":"harnessHeaders(null, {apiKey:'OWN'})","threw":false,"result":"{\"verdict\":\"reject\",\"status\":400,\"reason\":\"bad-headers\"}"},"harnessHeadersForwarded":{"input":"harnessHeaders([\"authorization\",\"x-api-key\",\"proxy-authorization\",\"cookie\",\"transfer-encoding\",\"content-length\",\"host\",\"connection\",\"x-other\",\"content-type\",\"accept\",\"anthropic-version\"] with values, {apiKey:\"OWN\"})","forwardedNames":["content-type","accept","anthropic-version","x-api-key"],"droppedNames":["authorization","proxy-authorization","cookie","transfer-encoding","content-length","host","connection","x-other"]},"passHeadersForwarded":{"forwardedNames":["authorization","x-api-key","proxy-authorization","cookie","transfer-encoding","content-length","x-other","content-type","accept","anthropic-version"],"droppedNames":["host","connection"]},"unitNotes":{"budgetUnit":"UTF-16 code units of the delta string, tokens estimated as ceil(chars/4)","zeroBudgetHaltsAtFirstDelta":"verified in corner sweep"}}
```

## Unmeasured (need a real Claude Code and an API key in a container)

| R | what is still open | needs |
| --- | --- | --- |
| R1 | event to OpenAI-style chunk mapping on recorded streams (the mapping is the harness listener, not built) | the listener, plus recorded real Messages streams |
| R5 | token estimate within 25 percent of final usage output tokens | recorded real turns (usage from message_delta) with text, thinking, tool_use |
| R6 | thinking tokens per turn with request parameters; reducer vs task outcome | live sessions, a key, an unreduced arm; PROGRAMME.md run count |
| R7 | what Claude Code keeps after an altered E text delta | real Claude Code behind the gateway and its next request body |
| R8 | terse flow: tokens per turn, completion | live sessions on real work, blue arm, key |
| R11 | auth-mode invariance end to end | a container with the key variable and one with a signed-in binary |
| R12 | no double retry: the page retry plus the Claude Code retry | a real Claude Code in the container and a flaky upstream |
| R13 | cache-hit ratio through the gateway within 2 points of direct | a scripted 30-turn session, key, real upstream, direct arm |
| R14 | acceptance of a synthetic stop sequence without retry or continue prompt | real Claude Code, key, each haltStopReason (end_turn, max_tokens) |
| R15 | cache-hit not lower, higher in a churn case, attribution block stays stripped | real upstream, key, scripted churn session, recorded requests |
| R16 | unpublished listener isolation and no forwarded credential | the node listeners (not built) and a container network; core shape and header-allowlist checks measured |
| R17 | thinking alteration signature rejection and recovery cost | real upstream, key, a tool loop with an altered thinking block |
| R9, R10 | later: mirror and tool execution once | routes A, B or E running |

