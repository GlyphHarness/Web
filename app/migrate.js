// Data schema version and forward migrations.
//
// A "bundle" is the one shape used for both localStorage and .session files:
//   { schema, sessions: [...], pads: [...] }
//
// Rules:
// - steps[n] turns a schema-n bundle into schema n+1.
// - A shipped step is never edited. A data change means SCHEMA+1 and a new step.
// - A build never writes data it loaded from a newer schema (it refuses to start).

export const SCHEMA = 1;

const steps = {
  // 1: b => { ...transform...; b.schema = 2; return b; },
};

export function migrate(bundle) {
  let b = bundle;
  if (!b || typeof b.schema !== 'number') throw new Error('Not a WebHarness bundle (no schema number).');
  if (b.schema > SCHEMA) {
    throw new Error(`Data is schema ${b.schema}; this build understands up to ${SCHEMA}. Load a newer build.`);
  }
  while (b.schema < SCHEMA) {
    const step = steps[b.schema];
    if (!step) throw new Error(`No migration from schema ${b.schema}.`);
    b = step(structuredClone(b));
  }
  return b;
}
