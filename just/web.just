set shell := ["bash", "-euo", "pipefail", "-c"]
set working-directory := ".."

[private]
default:
    @just --justfile "{{ justfile() }}" --list web

# Start the Vite dev server (vendors the VM and Pyright assets first)
dev:
    yarn dev

# Typecheck, vendor assets, build with Vite and verify the output
build:
    yarn build

# Type-check every TypeScript project (tsc -b)
[positional-arguments]
typecheck *args:
    yarn typecheck "$@"

# Run the unit tests once; arguments pass through to vitest, for eg. `just web test src/vm`
[positional-arguments]
test *args:
    yarn test "$@"

# Format every file with Prettier
[positional-arguments]
format *args:
    yarn format "$@"

# Check formatting without writing
[positional-arguments]
format-check *args:
    yarn format:check "$@"

# Copy v86, Pyright and their licenses from node_modules into public/
prepare-assets:
    yarn prepare:assets

# Install the husky git hooks
prepare:
    yarn prepare
