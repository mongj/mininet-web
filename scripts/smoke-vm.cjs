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
const results = [];
const vm = new V86({
  wasm_path: path.join(root, 'v86.wasm'),
  memory_size: 512 * 1024 * 1024,
  vga_memory_size: 2 * 1024 * 1024,
  bios: image('seabios.bin'),
  vga_bios: image('vgabios.bin'),
  bzimage: image('vmlinuz'),
  initrd: { buffer: ab(initrd) },
  cmdline:
    'console=ttyS0,115200 rdinit=/init random.trust_cpu=on tsc=reliable mitigations=off',
  autostart: true,
  disable_speaker: true,
  uart1: true,
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
async function command(s, timeout = 45000) {
  return atPrompt(s, /mininet> $/, timeout);
}
async function sh(s, timeout = 30000) {
  return atPrompt(s, /mininet-web:~# $/, timeout);
}
async function pushFile(guestPath, hostPath) {
  const encoded = fs.readFileSync(hostPath).toString('base64');
  return sh(`printf '%s' '${encoded}' | base64 -d > ${guestPath}`);
}
function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
}
function requireMatch(name, output, pattern) {
  assert.match(output, pattern, name);
  pass(name);
}

(async () => {
  try {
    await waitFor(/mininet-web:~# $/);

    const editors = await sh(
      'command -v vim && command -v nano && echo EDITORS_OK',
    );
    requireMatch('editors.vim', editors, /\/vim\b/);
    requireMatch('editors.nano', editors, /\/nano\b/);
    requireMatch('editors.ok', editors, /EDITORS_OK/);

    const tools = await sh(
      'for c in ping arping traceroute tracepath tcpdump ethtool ifconfig ip route python3 mnexec iptables ovs-vsctl ovs-ofctl tc iperf iperf3 brctl; do command -v "$c" >/dev/null && echo "HAVE $c" || echo "MISS $c"; done',
    );
    for (const name of [
      'ping',
      'arping',
      'traceroute',
      'tracepath',
      'tcpdump',
      'ethtool',
      'ifconfig',
      'ip',
      'route',
      'python3',
      'mnexec',
      'iptables',
      'ovs-vsctl',
      'ovs-ofctl',
      'tc',
      'iperf',
      'iperf3',
      'brctl',
    ]) {
      requireMatch('tool.' + name, tools, new RegExp('HAVE ' + name));
    }

    await command('mn --switch ovsbr --controller none --topo single,2');
    const ping = await command('pingall 1');
    requireMatch('mn.pingall', ping, /0% dropped \(2\/2 received\)/);
    const h1 = await command('h1 readlink /proc/self/ns/net');
    const h2 = await command('h2 readlink /proc/self/ns/net');
    const ns1 = h1.match(/net:\[(\d+)\]/)?.[1],
      ns2 = h2.match(/net:\[(\d+)\]/)?.[1];
    assert.ok(ns1 && ns2, 'namespaces');
    assert.notEqual(ns1, ns2, 'distinct namespaces');
    pass('mn.namespaces');
    const ovs = await command('sh ovs-vsctl show');
    requireMatch('mn.ovs.bridge', ovs, /Bridge s1/);
    requireMatch('mn.ovs.port1', ovs, /s1-eth1/);
    requireMatch('mn.ovs.port2', ovs, /s1-eth2/);
    await command('link h1 s1 down');
    requireMatch(
      'mn.link.down',
      await command('pingall 1'),
      /100% dropped \(0\/2 received\)/,
    );
    await command('link h1 s1 up');
    requireMatch(
      'mn.link.up',
      await command('pingall 1'),
      /0% dropped \(2\/2 received\)/,
    );
    requireMatch(
      'mn.of.normal',
      await command('sh ovs-ofctl dump-flows s1'),
      /actions=NORMAL/,
    );
    requireMatch(
      'mn.of10',
      await command('sh ovs-ofctl -O OpenFlow10 dump-flows s1'),
      /actions=NORMAL/,
    );
    await command('sh ovs-vsctl set bridge s1 protocols=OpenFlow10,OpenFlow13');
    requireMatch(
      'mn.of13',
      await command('sh ovs-ofctl -O OpenFlow13 dump-flows s1'),
      /actions=NORMAL/,
    );

    requireMatch(
      'host.ping',
      await command('h1 ping -c 1 -W 2 10.0.0.2'),
      /1 received|1 packets received/,
    );
    requireMatch(
      'host.arping',
      await command('h1 arping -c 1 -w 2 -I h1-eth0 10.0.0.2'),
      /1 packets received|Received 1 response/,
    );
    requireMatch(
      'host.traceroute',
      await command('h1 timeout 8 traceroute -n -w 1 -m 3 10.0.0.2'),
      /10\.0\.0\.2/,
    );
    requireMatch(
      'host.tracepath',
      await command('h1 timeout 8 tracepath -n 10.0.0.2'),
      /10\.0\.0\.2/,
    );
    requireMatch(
      'host.ethtool',
      await command('h1 ethtool h1-eth0'),
      /Settings for h1-eth0/,
    );
    requireMatch(
      'host.ifconfig',
      await command('h1 ifconfig h1-eth0'),
      /10\.0\.0\.1/,
    );
    requireMatch(
      'host.ip',
      await command('h1 ip addr show h1-eth0'),
      /10\.0\.0\.1/,
    );
    requireMatch(
      'host.route',
      await command('h1 ip route'),
      /10\.0\.0\.0\/24|h1-eth0/,
    );
    requireMatch(
      'host.python3',
      await command("h1 python3 -c 'print(42)'"),
      /^42$/m,
    );
    requireMatch(
      'host.tcpdump',
      await command('h1 tcpdump --version'),
      /tcpdump version|libpcap/,
    );
    requireMatch(
      'host.mnexec',
      await command('sh mnexec true && echo MNEXEC_OK'),
      /MNEXEC_OK/,
    );

    const iperf = await atPrompt('iperf h1 h2', /mininet> $/, 120000);
    requireMatch(
      'mn.iperf',
      iperf,
      /\*\*\* Results: \['[^']+\/sec', '[^']+\/sec'\]/,
    );
    await command('h1 iperf3 -s -1 -D');
    requireMatch(
      'mn.iperf3',
      await command('h2 timeout 10 iperf3 -c 10.0.0.1 -t 1', 30000),
      /Mbits\/sec|Gbits\/sec|Kbits\/sec/,
    );

    const from = all.length;
    vm.serial0_send('exit\n');
    await waitFor(/mininet-web:~# $/, from, 30000);
    pass('mn.cli.exit');

    await sh('mn -c && echo CLEAN_OK', 45000);
    pass('mn.clean');

    requireMatch(
      'api.examples.nat',
      await sh(
        'test -f /usr/lib/python3.12/site-packages/mininet/examples/nat.py && echo NAT_PY_OK',
      ),
      /NAT_PY_OK/,
    );

    const help = await sh('mn --help');
    requireMatch('mn.help.nat', help, /--nat/);
    requireMatch('mn.help.topo', help, /--topo/);

    const vlan = await sh(
      'ip link add dummy0 type dummy && ip addr add 192.0.2.1/24 dev dummy0 && ip link set dummy0 up && ip link add link dummy0 name dummy0.10 type vlan id 10 && ip -d link show dummy0.10 && echo VLAN_OK && ip link delete dummy0.10',
    );
    requireMatch('vlan.8021q', vlan, /802\.1Q|vlan/);
    requireMatch('vlan.8021q.id', vlan, /id 10/);
    requireMatch('vlan.8021q.ok', vlan, /VLAN_OK/);

    await pushFile('/tmp/_smoke_net.py', path.join(__dirname, '_smoke_net.py'));
    const pyNet = await sh('python3 /tmp/_smoke_net.py', 180000);
    requireMatch('api.surface', pyNet, /API_OK/);
    requireMatch('link.tc.netem', pyNet, /TCLINK_NETEM_OK/);
    requireMatch('link.tc.bw', pyNet, /TCLINK_BW_OK/);
    requireMatch('link.tc.delay', pyNet, /TCLINK_DELAY_OK/);
    requireMatch('link.tc.loss', pyNet, /TCLINK_LOSS_OK/);
    requireMatch('api.multi-switch', pyNet, /MULTI_SWITCH_OK/);
    requireMatch('ovs.stp', pyNet, /OVS_STP_OK/);
    requireMatch('ovs.vlan.tag', pyNet, /OVS_VLAN_TAG_OK/);
    requireMatch('nat.node', pyNet, /NAT_NODE_OK/);
    requireMatch('nat.forward', pyNet, /NAT_FORWARD_OK/);
    requireMatch('nat.masquerade', pyNet, /NAT_MASQUERADE_OK/);
    requireMatch('switch.ovsk.standalone', pyNet, /OVSK_STANDALONE_OK/);
    requireMatch('switch.lxbr', pyNet, /LXBR_OK/);
    requireMatch('switch.brctl', pyNet, /BRCTL_OK/);
    requireMatch('py.features', pyNet, /PY_FEATURES_OK/);

    requireMatch(
      'mn.topo.tree',
      await sh(
        'mn --switch ovsbr --controller none --topo tree,2 --test pingall',
        120000,
      ),
      /0% dropped/,
    );
    await sh('mn -c && echo CLEAN_OK', 45000);
    pass('mn.clean.again');
    requireMatch(
      'mn.second-topo',
      await sh(
        'mn --switch ovsbr --controller none --topo single,2 --test pingall',
        90000,
      ),
      /0% dropped \(2\/2 received\)/,
    );

    console.log(
      `\nPASS: ${results.length} checks in ${((Date.now() - start) / 1000).toFixed(1)}s`,
    );
    for (const item of results) console.log('  OK', item.name);
    vm.destroy();
    process.exit(0);
  } catch (error) {
    console.error('\nFAIL:', error);
    console.error(
      'Passed before failure:',
      results.map((item) => item.name).join(', ') || '(none)',
    );
    vm.destroy();
    process.exit(1);
  }
})();
