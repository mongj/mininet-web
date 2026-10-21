set shell := ["bash", "-euo", "pipefail", "-c"]
set working-directory := ".."

bin := "./node_modules/.bin"

[private]
default:
    @just --justfile "{{ justfile() }}" --list web

# Start the Vite dev server (vendors the VM and Pyright assets first)
dev:
    just web prepare-assets
    {{ bin }}/vite

# Typecheck, vendor assets, build with Vite and verify the output
build:
    just web typecheck
    just web prepare-assets
    {{ bin }}/vite build
    node scripts/verify-assets.mjs

# Type-check every TypeScript project (tsc -b)
[positional-arguments]
typecheck *args:
    {{ bin }}/tsc -b "$@"

# Lint with ESLint (fails on warnings); arguments pass through, for eg. `just web lint --fix`
[positional-arguments]
lint *args:
    {{ bin }}/eslint --max-warnings 0 . "$@"

# Run the unit tests once; arguments pass through to vitest, for eg. `just web test src/vm`
[positional-arguments]
test *args:
    {{ bin }}/vitest run "$@"

# Format every file with Prettier
[positional-arguments]
format *args:
    {{ bin }}/prettier --write . "$@"

# Check formatting without writing
[positional-arguments]
format-check *args:
    {{ bin }}/prettier --check . "$@"

# Copy v86, Pyright and their licenses from node_modules into public/
prepare-assets:
    node scripts/vendor-assets.mjs

# Add or update a shadcn component, for eg. `just web shadcn add button`
[positional-arguments]
shadcn *args:
    {{ bin }}/shadcn "$@"
