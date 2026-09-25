#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
task_tmp=$(mktemp -d "${TMPDIR:-/tmp}/mininet-v86.XXXXXX")
trap 'rm -rf "$task_tmp"' EXIT
docker build --platform linux/386 -t mininet-v86-poc:local guest
# Docker only packages the guest; it never runs a lab backend.
docker run --rm --platform linux/386 --network none --entrypoint /bin/sh mininet-v86-poc:local -c 'cat /boot/vmlinuz-virt' > public/vm/vmlinuz
if ! command -v zstd >/dev/null; then
  echo 'zstd is required to compress the guest initramfs' >&2
  exit 1
fi
# gzip -9 of the vim runtime exceeds what the 256 MiB guest can unpack.
# The virt kernel supports zstd initramfs (CONFIG_RD_ZSTD).
docker run --rm --platform linux/386 --network none --entrypoint /bin/sh mininet-v86-poc:local -c 'set -o pipefail; cd /; find . -xdev \( -path ./proc -o -path ./sys -o -path ./dev -o -path ./boot -o -path ./etc/hostname -o -path ./etc/hosts -o -path ./etc/resolv.conf -o -path ./.dockerenv \) -prune -o -print | cpio -o -H newc' | zstd -19 -c > "$task_tmp/guest.cpio.zst"
node scripts/package-guest.mjs "$task_tmp/guest.cpio.zst"
docker run --rm --platform linux/386 --network none mininet-v86-poc:local apk list --installed > guest/packages.txt
docker run --rm --platform linux/386 --network none mininet-v86-poc:local sh -c 'cat /boot/config-*' > guest/kernel.config
