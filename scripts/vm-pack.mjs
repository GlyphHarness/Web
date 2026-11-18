// Split a c2w image into parts GitHub Pages can serve (under 100 MB each) and
// write the manifest app/vm.js loads. Usage: node scripts/vm-pack.mjs OUT.wasm [NET.wasm]
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [img, net] = process.argv.slice(2);
const dir = new URL('../app/vm/image/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (/^out\./.test(f)) rmSync(dir + f);
const buf = readFileSync(img), PART = 45 * 1024 * 1024;
const id = createHash('sha256').update(buf).digest('hex').slice(0, 12);
const parts = [];
for (let i = 0, n = 0; i < buf.length; i += PART, n++) { const name = `out.${id}.${n}.part`; writeFileSync(dir + name, buf.subarray(i, i + PART)); parts.push(name); }
writeFileSync(dir + 'out.parts.json', JSON.stringify({ id, size: buf.length, parts }));
if (net) copyFileSync(net, dir + 'c2w-net-proxy.wasm');
console.log(`${parts.length} parts, ${(buf.length / 1048576).toFixed(1)} MB, id ${id}`);
