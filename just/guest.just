set shell := ["bash", "-euo", "pipefail", "-c"]
set working-directory := ".."

[private]
default:
    @just --justfile "{{ justfile() }}" --list guest

# Rebuild the guest kernel and initramfs into public/vm/ (needs Docker with linux/386 and zstd)
build:
    bash scripts/build-guest.sh

# Boot the guest in v86 under Node and run the Mininet smoke test
test:
    node scripts/smoke-vm.cjs

# Rebuild the guest, smoke-test it, then rebuild the app around it
rebuild:
    just guest build
    just guest test
    just web build
