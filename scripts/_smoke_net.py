#!/usr/bin/env python3
"""Mininet API and dataplane checks for scripts/smoke-vm.cjs.

Copied into the guest at runtime. Not part of the guest image.
"""
import subprocess

from mininet.cli import CLI
from mininet.link import TCLink
from mininet.log import setLogLevel
from mininet.net import Mininet
from mininet.node import Controller, Host, Node, OVSBridge, OVSKernelSwitch, OVSSwitch
from mininet.nodelib import LinuxBridge, NAT
from mininet.topo import LinearTopo, Topo
from mininet.topolib import TreeTopo


class StandaloneOVS(OVSKernelSwitch):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault('failMode', 'standalone')
        super().__init__(*args, **kwargs)


def ok(token):
    print(token, flush=True)


def run(*argv, timeout=20):
    return subprocess.run(
        argv, capture_output=True, text=True, timeout=timeout, check=False
    )


def check_api_surface():
    class T(Topo):
        pass

    assert callable(Mininet)
    assert issubclass(Host, object)
    assert issubclass(OVSSwitch, object)
    assert OVSKernelSwitch is OVSSwitch or issubclass(OVSKernelSwitch, OVSSwitch)
    assert issubclass(OVSBridge, OVSSwitch)
    assert issubclass(Controller, object)
    assert issubclass(TCLink, object)
    assert callable(CLI)
    assert issubclass(NAT, Node)
    assert issubclass(LinuxBridge, object)
    assert issubclass(LinearTopo, Topo)
    assert issubclass(TreeTopo, Topo)
    assert issubclass(T, Topo)
    ok('API_OK')


def check_tclink_nat_multi_switch():
    net = Mininet(
        switch=OVSBridge,
        controller=None,
        link=TCLink,
        autoSetMacs=True,
        build=False,
    )
    try:
        net.addHost('h1')
        net.addHost('h2')
        net.addSwitch('s1')
        net.addSwitch('s2')
        net.addLink(net['h1'], net['s1'], bw=10, delay='1ms', loss=10)
        net.addLink(net['s1'], net['s2'])
        net.addLink(net['s2'], net['h2'])
        net.addNAT(name='nat0', connect=net['s1'], ip='10.0.0.254/24', localIntf='dummy0')
        net.start()
        qdisc = net['h1'].cmd('tc qdisc show dev h1-eth0')
        assert 'netem' in qdisc, qdisc
        ok('TCLINK_NETEM_OK')
        assert 'htb' in qdisc or 'tbf' in qdisc, qdisc
        ok('TCLINK_BW_OK')
        assert 'delay' in qdisc, qdisc
        ok('TCLINK_DELAY_OK')
        assert 'loss' in qdisc, qdisc
        ok('TCLINK_LOSS_OK')
        vsctl = net['s1'].cmd('ovs-vsctl show')
        assert 'Bridge s1' in vsctl and 'Bridge s2' in vsctl, vsctl
        ok('MULTI_SWITCH_OK')
        net['s1'].cmd('ovs-vsctl set Bridge s1 stp_enable=true')
        stp = net['s1'].cmd('ovs-vsctl get Bridge s1 stp_enable').strip()
        assert stp == 'true', stp
        ok('OVS_STP_OK')
        net['s1'].cmd(
            'ovs-vsctl add-port s1 vlan10 tag=10 -- set interface vlan10 type=internal'
        )
        tag = net['s1'].cmd('ovs-vsctl get Port vlan10 tag').strip()
        assert tag == '10', tag
        ok('OVS_VLAN_TAG_OK')
        assert 'nat0' in net
        ok('NAT_NODE_OK')
        fwd = run('sysctl', '-n', 'net.ipv4.ip_forward')
        assert fwd.stdout.strip() == '1', fwd.stdout
        ok('NAT_FORWARD_OK')
        installed = run(
            'iptables',
            '-t',
            'nat',
            '-A',
            'POSTROUTING',
            '-s',
            '10.0.0.0/8',
            '!',
            '-d',
            '10.0.0.0/8',
            '-j',
            'MASQUERADE',
        )
        rules = run('iptables', '-t', 'nat', '-S')
        assert installed.returncode == 0 and 'MASQUERADE' in rules.stdout, rules.stdout
        ok('NAT_MASQUERADE_OK')
    finally:
        net.stop()
    run('mn', '-c', timeout=30)


def check_ovsk_standalone():
    net = Mininet(switch=StandaloneOVS, controller=None, autoSetMacs=True)
    try:
        h1 = net.addHost('h1', ip='10.0.0.1/24')
        h2 = net.addHost('h2', ip='10.0.0.2/24')
        s1 = net.addSwitch('s1')
        net.addLink(h1, s1)
        net.addLink(h2, s1)
        net.start()
        dropped = net.ping([h1, h2], timeout=1)
        assert dropped == 0.0, 'dropped=%s' % dropped
        ok('OVSK_STANDALONE_OK')
    finally:
        net.stop()
    run('mn', '-c', timeout=30)


def check_linux_bridge():
    net = Mininet(switch=LinuxBridge, controller=None, autoSetMacs=True)
    try:
        h1 = net.addHost('h1', ip='10.0.0.1/24')
        h2 = net.addHost('h2', ip='10.0.0.2/24')
        s1 = net.addSwitch('s1')
        net.addLink(h1, s1)
        net.addLink(h2, s1)
        net.start()
        dropped = net.ping([h1, h2], timeout=1)
        assert dropped == 0.0, 'dropped=%s' % dropped
        ok('LXBR_OK')
        br = run('brctl', 'show')
        assert 's1' in br.stdout, br.stdout
        ok('BRCTL_OK')
    finally:
        net.stop()
    run('mn', '-c', timeout=30)


def main():
    setLogLevel('warning')
    check_api_surface()
    check_tclink_nat_multi_switch()
    check_ovsk_standalone()
    check_linux_bridge()
    ok('PY_FEATURES_OK')


if __name__ == '__main__':
    main()
