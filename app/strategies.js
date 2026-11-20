// Orchestration strategies: named, versioned specs of how a session's turns are
// built and handled (docs/STEMS.md §8). A session group (profile) picks one with
// the `strategy` setting; every ledger row records the one it ran under, so
// strategies can be compared, and later models routed to the strategies they do best with.
//
// Id: strat-<name>-<major>.<minor>. A major version changes what the model sees
// (the turns, the handles, the tools); a minor version is harness-side tuning only.
//
// A spec is data the turn loop reads at fixed seams:
//   checkpoints  cache breakpoint kinds it may set (checkpoints.js), [] = none
//   stems        whether goals may be worked in stems (main.js openStem)
//   handles      'pull' (ids resolved by the model) | 'none'
//   confer       confer turns at stem checkpoints (not built yet: false everywhere)
//   resolver     a micro resolver picks what to materialize (not built yet: false everywhere)
//   stemFraming  'concern' (default: the concern line with the fold shape) | 'plain' (the goal only)
//   stemReasoning  null | 'low' | 'medium' | 'high': reasoning effort asked for on stem turns (OpenRouter)
//   reads        absent (a long result is a short view with a handle, whatever was asked) | 'ranged' (a range that is
//                asked for, lines of a file or of a stored output, comes back whole up to a cap; output_read takes
//                `lines`; a tool named inside run_js code is explained). Changes two tool descriptions (tools.js defsAs).
// register() adds more (experiments, other verticals), with the same shape.

const BUILT_IN = [
  { id: 'strat-serial-1.0', name: 'serial', describe: 'Plain serial turns: no explicit checkpoints, no stems. The baseline every other strategy is measured against.', checkpoints: [], stems: false, handles: 'none', confer: false, resolver: false },
  { id: 'strat-checkpoint-1.0', name: 'checkpoint', describe: 'Serial turns with cache checkpoints at the system prompt and the tail.', checkpoints: ['system', 'tail'], stems: false, handles: 'none', confer: false, resolver: false },
  { id: 'strat-stem-1.0', name: 'stem', describe: 'Checkpoints, stems with an anchor checkpoint, and opaque handles the model pulls.', checkpoints: ['system', 'tail', 'stem'], stems: true, handles: 'pull', confer: false, resolver: false },
  // 2.0 (what the model sees changes): the stem opens with the goal in plain words instead of the
  // "concern …" framing with the fold shape, and stem turns ask for low reasoning effort.
  // Live on qwen3.7-flash, 1.0's stems produced 4.8k-22k output tokens of mostly reasoning (issue #11).
  { id: 'strat-stem-2.0', name: 'stem', describe: 'Stems opened with the plain goal and low reasoning effort on stem turns; otherwise as strat-stem-1.0.', checkpoints: ['system', 'tail', 'stem'], stems: true, handles: 'pull', confer: false, resolver: false, stemFraming: 'plain', stemReasoning: 'low' },
  // serial 2.0 (what the model sees changes): ranged reads. In the H1 canary (strat-serial-1.0) a line range over
  // 1,500 characters came back head-and-tail, line numbers were passed where characters were expected, and
  // output_read was called from inside run_js (docs/concepts/HYPOTHESES.md).
  { id: 'strat-serial-2.0', name: 'serial', describe: 'Serial turns with ranged reads: a range that is asked for comes back whole (to a cap) and output_read takes lines; otherwise as strat-serial-1.0.', checkpoints: [], stems: false, handles: 'none', confer: false, resolver: false, reads: 'ranged' },
];
export const DEFAULT = 'strat-stem-1.0';
export const ID = /^strat-[a-z]+-\d+\.\d+$/;

const reg = new Map(BUILT_IN.map(s => [s.id, Object.freeze(s)]));
export function register(spec) {
  if (!ID.test(spec?.id || '')) throw new Error('a strategy id is strat-<name>-<major>.<minor>');
  if (reg.has(spec.id)) throw new Error(spec.id + ' is taken: a changed spec gets a new version');
  reg.set(spec.id, Object.freeze({ checkpoints: [], stems: false, handles: 'none', confer: false, resolver: false, ...spec }));
}
export const list = () => [...reg.values()];
export const known = id => reg.has(id);
// the spec a session runs under (an unknown or missing id falls back to the default)
export const spec = id => reg.get(id) || reg.get(DEFAULT);
