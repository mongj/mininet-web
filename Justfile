set shell := ["bash", "-euo", "pipefail", "-c"]

# List every recipe, including the ones in modules
default:
    @just --justfile "{{ justfile() }}" --list --list-submodules

# Vite app: dev server, build, typecheck, unit tests, formatting
mod web "just/web.just"

# Cloudflare Workers: local preview and deploy through Wrangler
mod cf "just/cf.just"

# Linux guest image for the v86 VM (guest/, public/vm/)
mod guest "just/guest.just"

# Git workflow (sync, rebase, done, prune)
mod git "just/git.just"

# Git worktrees
mod worktree "just/worktree.just"

# Install dependencies. Yarn then runs the prepare script, which installs the husky hook.
setup:
    yarn install --immutable

# Run the fast checks: typecheck, lint, unit tests, formatting
check:
    just web typecheck
    just web lint
    just web test
    just web format-check

# Run the fast checks, then the production build and asset verification
verify:
    just check
    just web build
