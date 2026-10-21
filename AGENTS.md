# Mininet Web

Client-only React 19 + Vite SPA that runs Linux, Mininet and Open vSwitch in a v86 x86 emulator inside a web worker. It ships as Cloudflare Workers static assets: there is no server entrypoint, API, binding or secret, and none should be added without asking. The architecture map is in [README.md](README.md#app-structure); contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Setup

- Node >= 22.12, Yarn 4.9.2 (Corepack, via `packageManager`), and [just](https://just.systems). Use `yarn` only as the package manager, never npm or pnpm.
- `just setup` installs dependencies, then `just web dev` serves the app locally.
- Commands live in the `Justfile` and `just/`. Recipes invoke the tools directly (`tsc`, `eslint`, `vitest`, `vite`, `wrangler`, `node scripts/…`). The only `package.json` script is `prepare` (`husky`): Yarn runs it on install, which a recipe cannot replace. Do not add task scripts.

## Verify

| Command                | Runs                                                        | When                                           |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| `just check`           | typecheck, ESLint, Vitest, Prettier check (under 10 s)      | After each change                              |
| `just verify`          | `just check`, then the production build and asset integrity | Before calling work done; CI runs exactly this |
| `just guest test`      | Boots the bundled guest in v86 under Node (about 1 min)     | Changes to `src/vm/`, `guest/` or `public/vm/` |
| `just cf deploy-check` | Wrangler dry run                                            | Changes to `wrangler.jsonc` or build output    |

Narrow loops: `just web test src/vm/9p`, `just web lint --fix`, `just web format`.

Work is done only when `just verify` passes. Never disable a lint rule, weaken or skip a test, or add `@ts-ignore` to get green; fix the cause or ask.

## Gotchas

- Three TypeScript projects: `tsconfig.app.json` (DOM), `tsconfig.worker.json` (WebWorker) and `tsconfig.node.json` (`vite.config.ts`). Everything reachable from `src/vm/emulator.worker.ts` compiles against WebWorker libs, so it must not use DOM APIs; modules shared with the page compile under both.
- Unit tests live in `__tests__/` next to the code, run in the Node environment (no DOM), and must be named `*.test.ts`; `.test.tsx` is not picked up.
- `public/vm/libv86.mjs`, `public/vm/v86.wasm`, `public/pyright/pyright.worker.js` and the license copies are generated from `node_modules` by `just web prepare-assets` and gitignored. Do not edit or commit them.
- The guest image (`public/vm/guest-*.bin`, `guest.json`, `vmlinuz`) is committed and SHA-256 verified by `scripts/verify-assets.mjs`. Regenerate it only with `just guest rebuild` (Docker with `linux/386`). Never hand-edit it. Every static file must stay under 25 MiB.
- UI primitives are shadcn on Base UI (`components.json`, `src/components/ui/`); add them with `just web shadcn add <name>`. Import app code through the `@/` alias.
- Dependencies are pinned to exact versions (`yarn add -E`); Dependabot bumps them weekly.
- The husky pre-commit hook runs `just web format` on the whole repo and re-stages the staged files.
- Never run `just cf deploy`, `just cf login`, `wrangler deploy` or `wrangler login`. Deploys are manual and done by the maintainer.

## Code rules

- Do NOT document architectural decisions in code comments. Put them in the commit message or PR description, or in README.md when they affect users or contributors.
- Write self-documenting code: clear names, small functions, explicit types. Add a comment only when the code cannot be made clear on its own, such as a non-obvious external constraint. Never add comments that restate what the code does.
- Match the surrounding style. Prettier owns formatting (single quotes, semicolons, sorted Tailwind classes).
- Add or update unit tests for behaviour you change.

## Workflow

- Before starting a large feature (several files, a new subsystem, or more than one commit of work), remind the user that it should be done in a separate git worktree and ask whether they want one, even if they did not mention it. Wait for the answer before writing code. Create it with `just worktree add <branch>` (a sibling checkout `../mininet-web--<branch>` off `origin/main`, with dependencies installed) or `just worktree start <branch>` to carry over uncommitted changes. Run every command from inside the worktree; after the PR merges, `just worktree done` removes it.
- Commits use Conventional Commits with a scope: `feat(explorer): …`, `fix(vm): …`. Common scopes are `editor`, `explorer`, `terminal`, `vm`, `guest`, `ui`, `settings` and `workspace`.
- Always prefer stacked PRs. Make each PR one atomic change that its description fully explains. Put a change that depends on another in its own PR stacked on top, with its base branch set to the PR below it, and name the stack in every description.
- Do not push or open a PR unless the user asks.
- When a change alters commands, layout or conventions, update this file and README.md in the same change.
