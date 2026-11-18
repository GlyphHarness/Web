# Third-party files in app/vm/

- `worker.js`, `worker-util.js`, `wasi-util.js`, `stack.js`, `stack-worker.js`, `browser_wasi_shim/`:
  from container2wasm `examples/wasi-browser` (Apache-2.0, LICENSE.container2wasm), commit 3f0f9be,
  with WebHarness changes marked `WebHarness` (relative paths, image parts and cache, guest env,
  credential hook, response headers and error bodies).
- `xterm-pty.js`, `xterm-pty-workerTools.js`: xterm-pty 0.9.4 (MIT).
- `image/` (deployed from the `vm-image` branch): the container2wasm image and c2w-net-proxy.wasm.
