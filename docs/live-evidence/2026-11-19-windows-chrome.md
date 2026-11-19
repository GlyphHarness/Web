# Live evidence, 2026-11-19 (issue #4)

One real run per path, driven through `scripts/wh.mjs` against the installed Google Chrome on Windows 11 (`WH_CHROME=1`), page served from `http://localhost:8787/`, no fakes and no proxy. Model `qwen/qwen3.7-flash`, helper `tencent/hy4-flash`. Writes went to throwaway repos in the `GlyphHarness` org (`wh-live-sandbox`, `wh-live-sandbox-2`); every write waited on its approval card, which the operator read before allowing.

Traces (exported with `wh trace`, scanned for key and token patterns before commit; none found):

- [`issue4-live-evidence.trace`](issue4-live-evidence.trace): 16 exchanges, `openrouter.ai` and `api.github.com`
- [`issue4-live-concern.trace`](issue4-live-concern.trace): 3 exchanges

| Path | Result | Where to look |
| --- | --- | --- |
| OpenRouter streaming with tools | ok. Ten chat requests, status 200, 21 tool definitions each; `run_js`, `repo_commit`, `repo_create` calls round-tripped | evidence trace, `openrouter.ai/api/v1/chat/completions` |
| `usage.prompt_tokens_details.cached_tokens` | reported. 0 for the first six requests, then 4096, 4480, 4480, 4480 | requests 6 to 9 in the evidence trace |
| `provider.order` pinning | ok. Request 0 carries no order; requests 1 to 9 carry `["Alibaba"]` and Alibaba served them | request bodies and `provider` field of the stream |
| GitHub CORS | ok. All calls from the `localhost` origin to `api.github.com` succeeded (a rejected preflight would have failed the fetch) | both traces |
| `createCommitOnBranch` | ok. Branch `live-evidence` created (ref probe 404, base ref 200, `POST git/refs` 201), then `POST /graphql` 200; content checked on GitHub | evidence trace |
| `POST /issues` (`concern_file`) | ok. Issue #1 in `wh-live-sandbox`, labelled `concern`, `kind:other` | concern trace |
| Repository creation | ok. `POST /orgs/GlyphHarness/repos` 201, private, description set | evidence trace |
| GitHub App token minting | **not run**: no GitHub App credentials were available | open |

What the run also showed, for the cost concerns (#5, #11): the first six requests on this model got no cache hits at all (4k to 8k uncached input each); hits began at request 7, once the prefix was long enough to cache.

Operator notes: the `wh` daemon port defaults to 8790, which another local service held, so `WH_PORT=8795` was used. `wh allow` and `wh deny` answer approval cards; `say` and `step` return `APPROVE?` with the card text instead of waiting.
