import fs from 'node:fs';
import crypto from 'node:crypto';
const data = fs.readFileSync(process.argv[2]);
for (const name of fs.readdirSync('public/vm')) {
  if (/^guest-\d+\.bin$/.test(name)) fs.unlinkSync(`public/vm/${name}`);
}
const chunks = [];
for (let pos = 0, i = 0; pos < data.length; pos += 8 * 1024 * 1024, i++) {
  const part = data.subarray(pos, pos + 8 * 1024 * 1024);
  const name = `guest-${i}.bin`;
  fs.writeFileSync(`public/vm/${name}`, part);
  chunks.push({
    file: name,
    bytes: part.length,
    sha256: crypto.createHash('sha256').update(part).digest('hex'),
  });
}
fs.writeFileSync(
  'public/vm/guest.json',
  JSON.stringify({ bytes: data.length, chunks }, null, 2) + '\n',
);
console.log(
  `Guest initramfs: ${(data.length / 1024 / 1024).toFixed(1)} MiB in ${chunks.length} chunks`,
);
