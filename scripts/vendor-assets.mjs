import fs from 'node:fs';

// Served as they are instead of going through the bundler: the emulator is
// loaded by URL inside its worker, and the language server is a 17 MB worker
// script that only people who turn IntelliSense on should download.
const files = [
  ['v86/build/libv86.mjs', 'public/vm/libv86.mjs'],
  ['v86/build/v86.wasm', 'public/vm/v86.wasm'],
  ['v86/LICENSE', 'public/vm/v86.LICENSE'],
  [
    'browser-basedpyright/dist/pyright.worker.js',
    'public/pyright/pyright.worker.js',
  ],
  ['browser-basedpyright/LICENSE.txt', 'public/pyright/basedpyright.LICENSE'],
];
for (const directory of ['public/vm', 'public/pyright']) {
  fs.mkdirSync(directory, { recursive: true });
}
for (const [source, destination] of files) {
  fs.copyFileSync(`node_modules/${source}`, destination);
}
console.log('Prepared v86 and basedpyright assets.');
