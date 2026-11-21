# Voice skill (seed)

Read before recrafting. You get one item and the concern it serves. Return it restructured in the voice asked for. Keep every decision, fact and number. Drop loops that end where they began. Do not rename anything in the protected list or anything that looks like a name, label or group (identifiers, paths, branch names, tags, handles, quoted text). If unsure, return the item unchanged.

## Voices

| Voice | Shape | Use for | Keeps |
| --- | --- | --- | --- |
| `terse-log` | one line: asked, decided, done, open; ids for what is behind it | the step line each turn carries | outcome only |
| `plain-brief` | two to four short sentences, no hedges | replies carried into later turns | outcome and the main reason |
| `plan-list` | numbered steps, imperative | a plan the model will follow | order and dependencies |
| `rationale-short` | claim, then one reason, then the cost of being wrong | a choice someone may review | the reason |
| `question` | one question, then the options it chooses between | anything waiting on a person | the options |

## Habits to cut (generic)

- Restarting the same thought ("let me think again", "wait", "actually") when it lands on the same answer.
- Restating the task before doing it.
- Narrating each tool call before and after it.
- Listing alternatives that were never in play.

## Example (illustrative, written for this seed, not a captured trace)

Before: "Let me plan the edits. I need a slot in machine(). Wait, maybe it belongs in run() instead. Actually run() is where the command starts, so set it there, but clear it after. Hmm, does it need a finally? Yes, otherwise a throw leaves it set."

After (`plan-list`): "1. Add `activeSession` in `machine()`. 2. Set it in `run()` from `opt.session`; clear it in a `finally`, so a throw cannot leave it set."

## Glossary (crafted terms; never renamed)

handle, stem, fold, anchor, core, checkpoint, probe, steward, concern, strategy, resolver, confer, smell, ledger.

## Per-model habits

| Model | Seen | Source |
| --- | --- | --- |
| `tencent/hy4-flash` | long reasoning that re-reads the same lines; many `output_read` calls with the same result | live session, issue 1 |
| `qwen/qwen3.7-flash` | edit find-strings that do not match the file exactly | live session, issue 1 |
