#!/usr/bin/env python3
"""Two real network namespaces, veth links, and an Open vSwitch bridge."""
from mininet.net import Mininet
from mininet.node import OVSBridge
from mininet.cli import CLI
from mininet.log import setLogLevel

setLogLevel('info')
net = Mininet(switch=OVSBridge, controller=None, autoSetMacs=True)
try:
    h1 = net.addHost('h1', ip='10.0.0.1/24')
    h2 = net.addHost('h2', ip='10.0.0.2/24')
    s1 = net.addSwitch('s1')
    net.addLink(h1, s1)
    net.addLink(h2, s1)
    net.start()
    print('BROWSER_TOPOLOGY_READY', flush=True)
    CLI(net)
finally:
    net.stop()
