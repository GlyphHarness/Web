# Gateway core, deterministic measurements (2026-11-21)

Script `scripts/measure-gateway.mjs`, core `app/claude-gateway.js` (sha256 2bc255f5116cd552, repo head 8193fe1). Synthetic streams and bodies from a seeded PRNG; no network, no model, no key. Full JSON: `docs/concepts/results/gateway-det-2026-11-21.json`. Hypotheses: `docs/platform/claude-route-survey.md` (R-numbers). Timing is wall clock on one machine (win32 x64, node v24.1.0), indicative only; counts, sweeps and hashes are deterministic.

**Checks run: 1034632, failed: 0.** Determinism: two full runs, hash equal (792c9f9bcd903acc). Halt sweep points: 86776 single-budget plus 2240 combined-budget trials plus 72 corner budgets. Credential canary: 816 probes, 0 leaks.

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
| fz-stream-throws-classed | 1 | 0 |
| fz-admit-matches-model | 1 | 0 |

## Per-event overhead (indicative)

Timer overhead per call 0.179 us (not subtracted).

| stream | events | listener | policy | us/event | events/s |
| --- | --- | --- | --- | --- | --- |
| text-1K | 50 | claude-code | pass-through (no policy) | 0.85 | 1176470 |
| text-1K | 50 | claude-code | budget set, never reached | 0.822 | 1216544 |
| text-1K | 50 | claude-code | text reducer | 1.4 | 714285 |
| text-1K | 50 | claude-code | text and thinking reducers + budget | 1.55 | 645160 |
| text-1K | 50 | harness | pass-through (no policy) | 0.782 | 1278771 |
| text-1K | 50 | harness | budget set, never reached | 0.74 | 1351354 |
| text-1K | 50 | harness | text reducer | 1.298 | 770416 |
| text-1K | 50 | harness | text and thinking reducers + budget | 1.354 | 738553 |
| mixed-1K | 55 | claude-code | pass-through (no policy) | 0.662 | 1510991 |
| mixed-1K | 55 | claude-code | budget set, never reached | 0.753 | 1328500 |
| mixed-1K | 55 | claude-code | text reducer | 0.9 | 1111111 |
| mixed-1K | 55 | claude-code | text and thinking reducers + budget | 0.971 | 1029962 |
| mixed-1K | 55 | harness | pass-through (no policy) | 0.776 | 1288058 |
| mixed-1K | 55 | harness | budget set, never reached | 0.889 | 1124744 |
| mixed-1K | 55 | harness | text reducer | 0.965 | 1035779 |
| mixed-1K | 55 | harness | text and thinking reducers + budget | 1.185 | 843559 |
| longthink-1K | 60 | claude-code | pass-through (no policy) | 0.64 | 1562503 |
| longthink-1K | 60 | claude-code | budget set, never reached | 0.747 | 1339284 |
| longthink-1K | 60 | claude-code | text reducer | 0.7 | 1428570 |
| longthink-1K | 60 | claude-code | text and thinking reducers + budget | 0.778 | 1284800 |
| longthink-1K | 60 | harness | pass-through (no policy) | 0.758 | 1318684 |
| longthink-1K | 60 | harness | budget set, never reached | 1.375 | 727273 |
| longthink-1K | 60 | harness | text reducer | 0.888 | 1125703 |
| longthink-1K | 60 | harness | text and thinking reducers + budget | 1.305 | 766284 |
| small-1K | 1025 | claude-code | pass-through (no policy) | 0.791 | 1264964 |
| small-1K | 1025 | claude-code | budget set, never reached | 0.884 | 1130972 |
| small-1K | 1025 | claude-code | text reducer | 0.944 | 1059213 |
| small-1K | 1025 | claude-code | text and thinking reducers + budget | 1.203 | 830969 |
| small-1K | 1025 | harness | pass-through (no policy) | 0.761 | 1314271 |
| small-1K | 1025 | harness | budget set, never reached | 0.919 | 1088457 |
| small-1K | 1025 | harness | text reducer | 1.025 | 975912 |
| small-1K | 1025 | harness | text and thinking reducers + budget | 1.159 | 863158 |
| small-10K | 10241 | claude-code | pass-through (no policy) | 0.709 | 1409461 |
| small-10K | 10241 | claude-code | budget set, never reached | 0.922 | 1084312 |
| small-10K | 10241 | claude-code | text reducer | 1.07 | 934406 |
| small-10K | 10241 | claude-code | text and thinking reducers + budget | 1.179 | 847919 |
| small-10K | 10241 | harness | pass-through (no policy) | 0.889 | 1124557 |
| small-10K | 10241 | harness | budget set, never reached | 1.098 | 910878 |
| small-10K | 10241 | harness | text reducer | 1.203 | 831081 |
| small-10K | 10241 | harness | text and thinking reducers + budget | 1.372 | 728814 |
| text-100K | 4338 | claude-code | pass-through (no policy) | 0.853 | 1172116 |
| text-100K | 4338 | claude-code | budget set, never reached | 1.033 | 967699 |
| text-100K | 4338 | claude-code | text reducer | 1.613 | 620077 |
| text-100K | 4338 | claude-code | text and thinking reducers + budget | 1.853 | 539566 |
| text-100K | 4338 | harness | pass-through (no policy) | 0.866 | 1154706 |
| text-100K | 4338 | harness | budget set, never reached | 0.885 | 1130129 |
| text-100K | 4338 | harness | text reducer | 1.48 | 675585 |
| text-100K | 4338 | harness | text and thinking reducers + budget | 1.511 | 661835 |
| mixed-100K | 4285 | claude-code | pass-through (no policy) | 0.708 | 1412699 |
| mixed-100K | 4285 | claude-code | budget set, never reached | 0.91 | 1098915 |
| mixed-100K | 4285 | claude-code | text reducer | 1.006 | 994038 |
| mixed-100K | 4285 | claude-code | text and thinking reducers + budget | 1.047 | 954704 |
| mixed-100K | 4285 | harness | pass-through (no policy) | 0.649 | 1540480 |
| mixed-100K | 4285 | harness | budget set, never reached | 0.836 | 1195925 |
| mixed-100K | 4285 | harness | text reducer | 0.908 | 1101061 |
| mixed-100K | 4285 | harness | text and thinking reducers + budget | 1.109 | 901707 |
| longthink-100K | 4276 | claude-code | pass-through (no policy) | 0.656 | 1523715 |
| longthink-100K | 4276 | claude-code | budget set, never reached | 0.868 | 1151660 |
| longthink-100K | 4276 | claude-code | text reducer | 0.677 | 1476315 |
| longthink-100K | 4276 | claude-code | text and thinking reducers + budget | 0.861 | 1161799 |
| longthink-100K | 4276 | harness | pass-through (no policy) | 0.791 | 1263668 |
| longthink-100K | 4276 | harness | budget set, never reached | 0.828 | 1207978 |
| longthink-100K | 4276 | harness | text reducer | 0.788 | 1268579 |
| longthink-100K | 4276 | harness | text and thinking reducers + budget | 1.343 | 744610 |
| small-100K | 102401 | claude-code | pass-through (no policy) | 0.786 | 1271882 |
| small-100K | 102401 | claude-code | text and thinking reducers + budget | 0.935 | 1069135 |
| small-100K | 102401 | harness | pass-through (no policy) | 0.83 | 1204256 |
| small-100K | 102401 | harness | text and thinking reducers + budget | 1.419 | 704835 |
| text-1M | 43870 | claude-code | pass-through (no policy) | 0.973 | 1027771 |
| text-1M | 43870 | claude-code | text and thinking reducers + budget | 2.218 | 450830 |
| text-1M | 43870 | harness | pass-through (no policy) | 1.099 | 909687 |
| text-1M | 43870 | harness | text and thinking reducers + budget | 1.805 | 553926 |
| mixed-1M | 43785 | claude-code | pass-through (no policy) | 0.809 | 1236669 |
| mixed-1M | 43785 | claude-code | text and thinking reducers + budget | 0.958 | 1043357 |
| mixed-1M | 43785 | harness | pass-through (no policy) | 0.656 | 1525073 |
| mixed-1M | 43785 | harness | text and thinking reducers + budget | 1.114 | 897681 |
| longthink-1M | 43692 | claude-code | pass-through (no policy) | 0.667 | 1500366 |
| longthink-1M | 43692 | claude-code | text and thinking reducers + budget | 1.034 | 967266 |
| longthink-1M | 43692 | harness | pass-through (no policy) | 0.771 | 1296341 |
| longthink-1M | 43692 | harness | text and thinking reducers + budget | 1.267 | 789047 |

### Per-step latency on mixed-100K, heaviest policy (R14 bound 5 ms at p95)

| listener | events | p50 us | p95 us | p99 us | max us | p95 vs 5 ms |
| --- | --- | --- | --- | --- | --- | --- |
| claude-code | 4285 | 1.7 | 4.3 | 8.1 | 446.7 | 0.086% of 5 ms |
| harness | 4285 | 1.8 | 2.3 | 3.4 | 22 | 0.046% of 5 ms |

Codec on mixed-100K (4285 events, 622576 bytes): format 1.101 us/event, split 2.038 us/event (71.297 MB/s).

## Memory across a long stream (indicative)

| listener | events | heap MB samples (after gc) | growth bytes/event | final state JSON bytes |
| --- | --- | --- | --- | --- |
| harness | 2000005 | 42.448 42.407 42.442 42.426 42.361 42.374 42.374 42.374 42.36 42.364 42.363 | -0.025 | 307 |
| claude-code | 2000005 | 42.354 42.37 42.37 42.37 42.372 42.372 42.372 42.372 42.372 42.372 42.372 | 0.001 | 315 |

## Per-request overhead (indicative), median ms per onRequest call

| turns | tools | markers | body KB | no policy | normalise | normalise+thinking |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 0 | 0 | 8 | 0 | 0.176 | 0.22 |
| 10 | 0 | 4 | 8 | 0 | 0.165 | 0.229 |
| 10 | 0 | 8 | 8 | 0 | 0.196 | 0.304 |
| 10 | 50 | 0 | 23 | 0 | 0.6 | 0.811 |
| 10 | 50 | 4 | 23 | 0 | 0.591 | 0.844 |
| 10 | 50 | 8 | 23 | 0 | 0.677 | 0.904 |
| 100 | 0 | 0 | 54 | 0 | 1.412 | 1.868 |
| 100 | 0 | 4 | 54 | 0 | 1.321 | 2.067 |
| 100 | 0 | 8 | 54 | 0 | 1.707 | 2.851 |
| 100 | 50 | 0 | 69 | 0 | 1.908 | 3.087 |
| 100 | 50 | 4 | 69 | 0 | 2.174 | 3.237 |
| 100 | 50 | 8 | 69 | 0 | 3.071 | 3.503 |
| 1000 | 0 | 0 | 517 | 0 | 19.9 | 24.851 |
| 1000 | 0 | 4 | 516 | 0 | 18.046 | 29.833 |
| 1000 | 0 | 8 | 518 | 0 | 21.595 | 35.202 |
| 1000 | 50 | 0 | 532 | 0.001 | 19.949 | 29.419 |
| 1000 | 50 | 4 | 531 | 0 | 17.367 | 25.804 |
| 1000 | 50 | 8 | 533 | 0 | 16.068 | 28.85 |

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

{"frames":24330,"cutsTried":37559,"jsonNullFrameYieldsEvents":"[null]","badFrameOrderRecoverable":"events and bad are returned in separate lists; their relative order is not"}

## Robustness fuzz (seeded)

streams 4000, bodies 4000, admits 12000. Thrown error classes (input minimal as found):

| class | count | minimal input |
| --- | --- | --- |
| streamStep: Cannot read properties of null (reading '_') | 245 | `null` |
| onRequest: (b.messages || []).forEach is not a function | 484 | `{"model":"m","tools":"x","system":[1,null],"messages":{},"thinking":{"content":"x"}}` |
| onRequest: Cannot create property '_' on string '_' | 200 | `{"model":"m","tools":[{"cache_control":{"type":"ephemeral"}},null,"x"],"messages":[[{"cache_control":{"type":"ephemeral"}},null,"x"],"x",{"role":"user","content":{"content":[null,{"cache_control":{}}]` |
| onRequest: Cannot read properties of null (reading '_') | 50 | `null` |
| admit: Cannot read properties of null (reading '_') | 1 | `null` |
| admit: Cannot read properties of undefined (reading '_') | 1 | `undefined` |
| headers: Cannot read properties of null (reading '_') | 2 | `passHeaders(null)` |

## Defects and spec gaps, minimal inputs (recorded in the catalog inbox as faults)

```json
{"streamStepNullEvent":{"input":"streamStep(streamInit('harness', {}, {}), null)","threw":true,"error":"Cannot read properties of null (reading 'type')","reachableFrom":"sseSplit('data: null\\n\\n').events -> [null]"},"onRequestNullBody":{"input":"onRequest({}, null, {cache:{normalise:true}})","threw":true,"error":"Cannot read properties of null (reading 'tools')","noPolicy":{"threw":false,"result":"{\"body\":null,\"applied\":[]}"}},"onRequestMessagesNotArray":{"input":"onRequest({}, {messages: {}}, {cache:{normalise:true}})","threw":true,"error":"(b.messages || []).forEach is not a function"},"onRequestStringToolAfterMarkedTool":{"input":"onRequest({}, {tools:[{name:'a',cache_control:{type:'ephemeral'}},'x'],messages:[]}, {cache:{normalise:true}})","threw":true,"error":"Cannot create property 'cache_control' on string 'x'"},"onRequestNullToolAfterMarkedTool":{"input":"onRequest({}, {tools:[{name:\"a\",cache_control:{type:\"ephemeral\"}},null],messages:[]}, {cache:{normalise:true}})","threw":true,"error":"Cannot read properties of null (reading 'cache_control')"},"admitNullRequest":{"input":"admit('harness', null)","threw":true,"error":"Cannot read properties of null (reading 'headers')"},"harnessHeadersForwarded":{"input":"harnessHeaders([\"authorization\",\"x-api-key\",\"proxy-authorization\",\"cookie\",\"transfer-encoding\",\"content-length\",\"host\",\"connection\",\"x-other\"] with values, {apiKey:\"OWN\"})","forwardedNames":["proxy-authorization","cookie","transfer-encoding","content-length","x-other","x-api-key"],"droppedNames":["authorization","host","connection"]},"passHeadersForwarded":{"forwardedNames":["authorization","x-api-key","proxy-authorization","cookie","transfer-encoding","content-length","x-other"],"droppedNames":["host","connection"]},"unitNotes":{"budgetUnit":"UTF-16 code units of the delta string, tokens estimated as ceil(chars/4)","zeroBudgetHaltsAtFirstDelta":"verified in corner sweep"}}
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
| R16 | unpublished listener isolation and no forwarded credential | the node listeners (not built) and a container network; core shape checks measured |
| R17 | thinking alteration signature rejection and recovery cost | real upstream, key, a tool loop with an altered thinking block |
| R9, R10 | later: mirror and tool execution once | routes A, B or E running |

