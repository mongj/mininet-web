#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

task_tmp=$(mktemp -d "${TMPDIR:-/tmp}/mininet-v86.XXXXXX")
trap 'rm -rf "$task_tmp"' EXIT

platform=linux/386
image=mininet-v86-built
rootfs="$task_tmp/guest.cpio.zst"

if ! command -v zstd >/dev/null; then
  echo 'zstd is required to compress the guest initramfs' >&2
  exit 1
fi

docker build --platform "$platform" -t "$image" guest

echo 'Extracting kernel...'
docker run --rm --platform "$platform" --network none --entrypoint /bin/sh \
  "$image" -c 'cat /boot/vmlinuz-virt' > public/vm/vmlinuz

echo 'Collecting guest packages...'
docker run --rm --platform "$platform" --network none "$image" \
  apk list --installed > guest/packages.txt

echo 'Collecting kernel configuration...'
docker run --rm --platform "$platform" --network none "$image" \
  sh -c 'cat /boot/config-*' > guest/kernel.config
  
echo 'Collecting Mininet source for the editor...'
mkdir -p public/pyright
docker run --rm -i --platform "$platform" --network none --entrypoint python3 \
  "$image" - < guest/export-mininet-source.py > public/pyright/mininet.json

echo 'Building guest rootfs...'
docker run --rm --platform "$platform" --network none --entrypoint /bin/sh \
  "$image" -c '
    set -o pipefail
    cd /
    find . -xdev \
      \( \
        -path ./proc -o \
        -path ./sys -o \
        -path ./dev -o \
        -path ./boot -o \
        -path ./etc/hostname -o \
        -path ./etc/hosts -o \
        -path ./etc/resolv.conf -o \
        -path ./.dockerenv \
      \) -prune -o -print \
      | cpio -o -H newc
  ' | zstd -19 -c > "$rootfs"

node scripts/package-guest.mjs "$rootfs"
