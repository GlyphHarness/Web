# Building the Linux machine image

    docker build -t wh-shell vm/
    c2w wh-shell out.wasm                         # container2wasm, WASI target (Bochs)
    make -C <container2wasm> c2w-net-proxy.wasm   # in-browser network stack
    node scripts/vm-pack.mjs out.wasm c2w-net-proxy.wasm

Then commit `app/vm/image/*` to the `vm-image` branch (orphan) and push `main` to deploy.
Behind a TLS-intercepting proxy (as in a sandboxed build), c2w's own build stages need:
the proxy CA at a path `ca-certificates` will not regenerate (e.g. /proxy-ca.crt) with
SSL_CERT_FILE, GIT_SSL_CAINFO, CURL_CA_BUNDLE, CARGO_HTTP_CAINFO and a wgetrc pointing at
it; apt sources rewritten to https with Acquire::https::CAInfo; bullseye stages pointed
at archive.debian.org; `--network=host`, proxy build args, and `--assets <local clone>`
when git tags are not reachable. None of it ends up in the image.
