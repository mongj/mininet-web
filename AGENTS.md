# Mininet Web

Client-only React 19 + Vite SPA that runs Linux, Mininet and Open vSwitch in a v86 x86 emulator inside a web worker. It ships as Cloudflare Workers static assets: there is no server entrypoint, API, binding or secret, and none should be added without asking. The architecture map is in [README.md](README.md#app-structure); contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Setup

- Node >= 22.12 and Yarn 4.9.2 (Corepack, via `packageManager`). Use `yarn` only, never npm or pnpm.
- `yarn install --immutable`, then `yarn dev` serves the app locally.

## Verify

| Command             | Runs                                                     | When                                           |
| ------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| `yarn verify:fast`  | typecheck, ESLint, Vitest, Prettier check (under 10 s)   | After each change                              |
| `yarn verify`       | `verify:fast`, then production build and asset integrity | Before calling work done; CI runs exactly this |
| `yarn test:vm`      | Boots the bundled guest in v86 under Node (about 1 min)  | Changes to `src/vm/`, `guest/` or `public/vm/` |
| `yarn deploy:check` | Wrangler dry run                                         | Changes to `wrangler.jsonc` or build output    |

Narrow loops: `yarn test src/vm/9p`, `yarn lint --fix`, `yarn format`. `just check` and `just verify` are aliases.

Work is done only when `yarn verify` passes. Never disable a lint rule, weaken or skip a test, or add `@ts-ignore` to get green; fix the cause or ask.

## Gotchas

- Three TypeScript projects: `tsconfig.app.json` (DOM), `tsconfig.worker.json` (WebWorker) and `tsconfig.node.json` (`vite.config.ts`). Everything reachable from `src/vm/emulator.worker.ts` compiles against WebWorker libs, so it must not use DOM APIs; modules shared with the page compile under both.
- Unit tests live in `__tests__/` next to the code, run in the Node environment (no DOM), and must be named `*.test.ts`; `.test.tsx` is not picked up.
- `public/vm/libv86.mjs`, `public/vm/v86.wasm`, `public/pyright/pyright.worker.js` and the license copies are generated from `node_modules` by `yarn prepare:assets` and gitignored. Do not edit or commit them.
- The guest image (`public/vm/guest-*.bin`, `guest.json`, `vmlinuz`) is committed and SHA-256 verified by `scripts/verify-assets.mjs`. Regenerate it only with `yarn build:guest` (Docker with `linux/386`), then `yarn test:vm` and `yarn build`. Never hand-edit it. Every static file must stay under 25 MiB.
- UI primitives are shadcn on Base UI (`components.json`, `src/components/ui/`); add them with `yarn shadcn add <name>`. Import app code through the `@/` alias.
- Dependencies are pinned to exact versions (`yarn add -E`); Dependabot bumps them weekly.
- The husky pre-commit hook runs `yarn format` on the whole repo and re-stages the staged files.
- Never run `yarn deploy`, `wrangler deploy` or `wrangler login`. Deploys are manual and done by the maintainer.

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
