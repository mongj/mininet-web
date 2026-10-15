set shell := ["bash", "-euo", "pipefail", "-c"]
set working-directory := ".."

[private]
default:
    @just --justfile "{{ justfile() }}" --list cf

# Build and serve the Worker locally on http://127.0.0.1:8787
[positional-arguments]
preview *args:
    yarn preview "$@"

# Build and deploy the Worker to Cloudflare (needs `yarn wrangler login` first)
[positional-arguments]
deploy *args:
    yarn deploy "$@"

# Build and validate the deploy without uploading anything
[positional-arguments]
deploy-check *args:
    yarn deploy:check "$@"
