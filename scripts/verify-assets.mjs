import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? 'dist';
const vmRoot = path.join(root, 'vm');
const manifest = JSON.parse(
  fs.readFileSync(path.join(vmRoot, 'guest.json'), 'utf8'),
);
let bytes = 0;
for (const chunk of manifest.chunks) {
  const content = fs.readFileSync(path.join(vmRoot, chunk.file));
  assert.equal(content.length, chunk.bytes, `${chunk.file}: size mismatch`);
  assert.equal(
    createHash('sha256').update(content).digest('hex'),
    chunk.sha256,
    `${chunk.file}: integrity check failed`,
  );
  bytes += content.length;
}
assert.equal(bytes, manifest.bytes, 'Incomplete guest image');
for (const file of [
  'libv86.mjs',
  'v86.wasm',
  'vmlinuz',
  'seabios.bin',
  'vgabios.bin',
]) {
  assert.ok(
    fs.statSync(path.join(vmRoot, file)).size > 0,
    `${file} is missing or empty`,
  );
}
// Workers Static Assets currently limits individual files to 25 MiB.
// Keep the guest chunked so no file exceeds that limit.
for (const entry of fs.readdirSync(root, {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile()) continue;
  const file = path.join(entry.parentPath, entry.name);
  assert.ok(
    fs.statSync(file).size <= 25 * 1024 * 1024,
    `Static asset exceeds 25 MiB: ${file}`,
  );
}
console.log('Guest integrity and deployment asset sizes verified.');
