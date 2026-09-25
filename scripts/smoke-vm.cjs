/** Actual x86 emulation; no Docker, network, or mocked Mininet results. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { V86 } = require('v86');
const root = path.resolve(__dirname, '../public/vm');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'guest.json')));
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const image = (name) => ({
  buffer: ab(fs.readFileSync(path.join(root, name))),
});
const initrd = Buffer.concat(
  manifest.chunks.map((c) => fs.readFileSync(path.join(root, c.file))),
);
let all = '',
  pending = '';
const start = Date.now();
const vm = new V86({
  wasm_path: path.join(root, 'v86.wasm'),
  memory_size: 256 * 1024 * 1024,
  vga_memory_size: 2 * 1024 * 1024,
  bios: image('seabios.bin'),
  vga_bios: image('vgabios.bin'),
  bzimage: image('vmlinuz'),
  initrd: { buffer: ab(initrd) },
  cmdline:
    'console=ttyS0,115200 rdinit=/init random.trust_cpu=on tsc=reliable mitigations=off',
  autostart: true,
  disable_speaker: true,
});
vm.add_listener('serial0-output-byte', (b) => {
  const c = String.fromCharCode(b);
  all += c;
  pending += c;
  if (c === '\n') {
    process.stdout.write(pending);
    pending = '';
  }
});
const clean = (s) => s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
async function waitFor(pattern, from = 0, timeout = 180000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const s = clean(all.slice(from));
    if (pattern.test(s)) return s;
    if (/Kernel panic|Traceback \(most recent call last\)/.test(s))
      throw Error(s.slice(-3000));
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Timed out: ' + all.slice(-3000));
}
async function atPrompt(s, prompt, timeout = 45000) {
  const from = all.length;
  vm.serial0_send(s + '\n');
  return waitFor(prompt, from, timeout);
}
async function command(s) {
  return atPrompt(s, /mininet> $/);
}
async function sh(s) {
  return atPrompt(s, /browser-lab:~# $/, 30000);
}
(async () => {
  try {
    await waitFor(/browser-lab:~# $/);
    const editors = await sh(
      'command -v vim && command -v nano && echo EDITORS_OK',
    );
    assert.match(editors, /\/vim\b/);
    assert.match(editors, /\/nano\b/);
    assert.match(editors, /EDITORS_OK/);
    await command('mn --switch ovsbr --controller none --topo single,2');
    const ping = await command('pingall 1');
    assert.match(ping, /0% dropped \(2\/2 received\)/);
    const h1 = await command('h1 readlink /proc/self/ns/net');
    const h2 = await command('h2 readlink /proc/self/ns/net');
    const ns1 = h1.match(/net:\[(\d+)\]/)?.[1],
      ns2 = h2.match(/net:\[(\d+)\]/)?.[1];
    assert.ok(ns1 && ns2);
    assert.notEqual(ns1, ns2);
    const ovs = await command('sh ovs-vsctl show');
    assert.match(ovs, /Bridge s1/);
    assert.match(ovs, /s1-eth1/);
    assert.match(ovs, /s1-eth2/);
    await command('link h1 s1 down');
    assert.match(await command('pingall 1'), /100% dropped \(0\/2 received\)/);
    await command('link h1 s1 up');
    assert.match(await command('pingall 1'), /0% dropped \(2\/2 received\)/);
    assert.match(await command('sh ovs-ofctl dump-flows s1'), /actions=NORMAL/);
    const from = all.length;
    vm.serial0_send('exit\n');
    await waitFor(/browser-lab:~# $/, from, 30000);
    console.log(
      `\nPASS: Mininet ping, distinct namespaces, OVS ports, link failure/recovery, OpenFlow table, CLI exit (${((Date.now() - start) / 1000).toFixed(1)}s)`,
    );
    vm.destroy();
    process.exit(0);
  } catch (error) {
    console.error('\nFAIL:', error);
    vm.destroy();
    process.exit(1);
  }
})();
