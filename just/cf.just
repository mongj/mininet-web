set shell := ["bash", "-euo", "pipefail", "-c"]
set working-directory := ".."

bin := "./node_modules/.bin"

[private]
default:
    @just --justfile "{{ justfile() }}" --list cf

# Build and serve the Worker locally on http://127.0.0.1:8787
[positional-arguments]
preview *args:
    {{ bin }}/wrangler preview "$@"

# Authenticate Wrangler with a Cloudflare account
[positional-arguments]
login *args:
    {{ bin }}/wrangler login "$@"

# Build and deploy the Worker to Cloudflare (needs `just cf login` first)
[positional-arguments]
deploy *args:
    {{ bin }}/wrangler deploy "$@"

# Build and validate the deploy without uploading anything
[positional-arguments]
deploy-check *args:
    {{ bin }}/wrangler deploy --dry-run "$@"
