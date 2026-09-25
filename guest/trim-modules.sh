#!/bin/sh
set -eu
# The RAM-only appliance needs networking modules, not disk/display drivers.
version=$(ls /lib/modules)
mkdir -p /tmp/keep-modules
for module in veth bridge openvswitch sch_netem sch_htb sch_tbf sch_fq_codel cls_u32 cls_fw ifb; do
  modprobe -S "$version" --show-depends "$module"
done | awk '$1 == "insmod" {print $2}' | sort -u > /tmp/modules-needed
while IFS= read -r file; do cp --parents "$file" /tmp/keep-modules; done < /tmp/modules-needed
rm -rf "/lib/modules/$version/kernel"
cp -a /tmp/keep-modules/lib/modules/. /lib/modules/
depmod "$version"
rm -rf /tmp/keep-modules /tmp/modules-needed
