# Contributing to Mininet Web

Thanks for your interest in contributing! This is still a very early project, so there are definitely many rough edges. Bug reports, feature ideas, documentation fixes, and code changes are all welcome :)

## Reporting bugs and suggesting features

Open an [issue](https://github.com/mongj/mininet-web/issues/new/choose) using the bug report or feature request template. Please search the existing issues first to avoid duplicates.

For bugs, it's helpful to include your browser and OS, especially since the entire app runs on the client side.

## Making changes

1. Fork the repository and create a branch from `main`.
2. Make your change. Keep each pull request focused on one thing.
3. Add or update tests for the behaviour you changed. Unit tests live in `__tests__/` folders next to the code they cover.
4. Run the checks below.
5. Open a pull request against `main`.

### Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org), with an optional scope naming the area of the app:

```text
feat(editor): add opt-in Python IntelliSense
fix(editor): keep suggestion widgets above docked panes
docs: describe the workspace shell
```

Common types are `feat`, `fix`, `docs`, `refactor`, `perf`, `build`, and `chore`. Common scopes are `editor`, `explorer`, `terminal`, `vm`, `guest`, `ui`, and `settings`.

### Changing the Linux guest

Changes to software inside the guest or to `guest/lab.py` require rebuilding the image, which needs Docker with `linux/386` support:

```sh
yarn build:guest
yarn test:vm
yarn build
```

Commit the regenerated files under `public/vm/` together with your change. See [Rebuilding the Linux guest](README.md#rebuilding-the-linux-guest) for details.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
