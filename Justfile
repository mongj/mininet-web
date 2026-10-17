set shell := ["bash", "-euo", "pipefail", "-c"]

# List every recipe, including the ones in modules
default:
    @just --justfile "{{ justfile() }}" --list --list-submodules

# Vite app: dev server, build, typecheck, unit tests, formatting (package.json scripts)
mod web "just/web.just"

# Cloudflare Workers: local preview and deploy through Wrangler
mod cf "just/cf.just"

# Linux guest image for the v86 VM (guest/, public/vm/)
mod guest "just/guest.just"

# Git workflow (sync, rebase, done, prune)
mod git "just/git.just"

# Git worktrees
mod worktree "just/worktree.just"

# Install dependencies and the husky pre-commit hook
setup:
    yarn install --immutable
    yarn prepare

# Run the fast checks: typecheck, lint, unit tests, formatting
check:
    yarn verify:fast

# Run the fast checks, then the production build and asset verification
verify:
    yarn verify
