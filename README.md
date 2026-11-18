# vm-image

Files for WebHarness's Linux machine, copied into `app/vm/image/` by the Pages
workflow on `main`. Kept off `main` so its history does not grow by the image size.

- `out.<id>.<n>.part` + `out.parts.json`: container2wasm (WASI, Bochs x86_64) build of
  Alpine 3.20 with bash, coreutils, git, python3, github-cli, curl, jq.
- `c2w-net-proxy.wasm`: container2wasm's in-browser network stack.

container2wasm is Apache-2.0 (https://github.com/ktock/container2wasm); the image
bundles Bochs (LGPL) and Alpine packages under their own licences.
