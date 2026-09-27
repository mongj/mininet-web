import fs from 'node:fs';
import crypto from 'node:crypto';

const MiB = 1024 * 1024;
const CHUNK_SIZE = 8 * MiB;
const OUTPUT_DIR = 'public/vm';
const MANIFEST_PATH = `${OUTPUT_DIR}/guest.json`;

// Workers Static Assets limit individual files to 25 MiB. We split the initramfs at 16 MiB here.
const data = fs.readFileSync(process.argv[2]);

for (const name of fs.readdirSync(OUTPUT_DIR)) {
  if (/^guest-\d+\.bin$/.test(name)) fs.unlinkSync(`${OUTPUT_DIR}/${name}`);
}

const chunks = [];
for (let pos = 0, i = 0; pos < data.length; pos += CHUNK_SIZE, i++) {
  const part = data.subarray(pos, pos + CHUNK_SIZE);
  const name = `guest-${i}.bin`;
  fs.writeFileSync(`${OUTPUT_DIR}/${name}`, part);
  chunks.push({
    file: name,
    bytes: part.length,
    sha256: crypto.createHash('sha256').update(part).digest('hex'),
  });
}

fs.writeFileSync(
  MANIFEST_PATH,
  JSON.stringify({ bytes: data.length, chunks }, null, 2) + '\n',
);
console.log(
  `Guest initramfs: ${(data.length / MiB).toFixed(1)} MiB in ${chunks.length} chunks`,
);
