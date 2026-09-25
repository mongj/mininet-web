import fs from 'node:fs';

const destination = 'public/vm';
fs.mkdirSync(destination, { recursive: true });
const files = [
  ['v86/build/libv86.mjs', 'libv86.mjs'],
  ['v86/build/v86.wasm', 'v86.wasm'],
  ['v86/LICENSE', 'v86.LICENSE'],
  ['@xterm/xterm/LICENSE', 'xterm.LICENSE'],
  ['@xterm/addon-fit/LICENSE', 'addon-fit.LICENSE'],
];
for (const [source, name] of files) {
  fs.copyFileSync(`node_modules/${source}`, `${destination}/${name}`);
}
console.log('Prepared v86 assets and third-party notices.');
