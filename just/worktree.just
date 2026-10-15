set shell := ["bash", "-euo", "pipefail", "-c"]
set working-directory := ".."

# The branch origin/HEAD points at (main unless the remote says otherwise)
base := `git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || echo main`

[private]
default:
    @just --justfile "{{ justfile() }}" --list worktree

# List all worktrees
list:
    git worktree list

# Create a worktree next to the main checkout (../mininet-web--<branch>) from origin/main, or from the existing branch
[positional-arguments]
add branch:
    #!/usr/bin/env bash
    set -euo pipefail
    BRANCH=$(git check-ref-format --branch "$1")
    # Anchor on the main worktree so a worktree made from inside another one is
    # created as a sibling of the main checkout, not nested inside the current one.
    MAIN=$(git worktree list --porcelain | awk 'NR==1{sub(/^worktree /, ""); print}')
    WT="$(dirname "$MAIN")/$(basename "$MAIN")--${BRANCH//\//-}"
    cd "$MAIN"
    git fetch origin "{{ base }}"
    # show-ref only sees local refs, so look for the branch on origin too; otherwise
    # a branch that only exists remotely would be re-created off origin/{{ base }}.
    REMOTE_OK=0
    if git fetch --quiet origin "$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null; then
      REMOTE_OK=1
    fi
    if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
      git worktree add "$WT" "$BRANCH"
    elif [ "$REMOTE_OK" = 1 ]; then
      git worktree add "$WT" -b "$BRANCH" "origin/$BRANCH"
    else
      # --no-track: tracking origin/{{ base }} would make a plain `git push` refuse.
      git worktree add --no-track "$WT" -b "$BRANCH" "origin/{{ base }}"
    fi
    echo "{{ YELLOW }}Installing dependencies in the new worktree...{{ NORMAL }}"
    (cd "$WT" && yarn install --immutable && yarn prepare)
    echo "{{ GREEN }}Worktree ready at $WT{{ NORMAL }}"
    echo "cd \"\$(just worktree path $BRANCH)\""

# Like `add`, but moves your uncommitted changes (including untracked files) into the new worktree
[positional-arguments]
start branch:
    #!/usr/bin/env bash
    set -euo pipefail
    BRANCH=$(git check-ref-format --branch "$1")
    STASHED=0
    if [ -n "$(git status --porcelain)" ]; then
      echo "{{ YELLOW }}Stashing uncommitted changes...{{ NORMAL }}"
      git stash push -u -m "worktree start: moving to $BRANCH"
      STASHED=1
    fi
    if ! just --justfile "{{ justfile() }}" worktree add "$BRANCH"; then
      [ "$STASHED" = 1 ] && echo "{{ RED }}Worktree not created; your changes are in stash@{0} (run 'git stash pop' here to get them back).{{ NORMAL }}" >&2
      exit 1
    fi
    [ "$STASHED" = 1 ] || exit 0
    MAIN=$(git worktree list --porcelain | awk 'NR==1{sub(/^worktree /, ""); print}')
    WT="$(dirname "$MAIN")/$(basename "$MAIN")--${BRANCH//\//-}"
    # The stash is shared by every worktree of this clone, so it can be popped there.
    if git -C "$WT" stash pop; then
      echo "{{ GREEN }}Moved your changes to $WT{{ NORMAL }}"
    else
      # Git keeps the stash entry whenever a pop does not fully succeed. Popping again
      # would re-apply whatever already landed, so point at the entry instead.
      echo "{{ RED }}Your changes did not apply cleanly in $WT; the stash entry is kept.{{ NORMAL }}" >&2
      echo "{{ YELLOW }}Check 'git -C $WT status'. Once everything you need is in place, run:{{ NORMAL }}" >&2
      echo "{{ YELLOW }}  git -C $WT stash drop{{ NORMAL }}" >&2
      exit 1
    fi

# Print a branch's worktree path, for eg. cd "$(just worktree path my-branch)"
[positional-arguments]
path branch:
    #!/usr/bin/env bash
    set -euo pipefail
    WT=$(git worktree list --porcelain | awk -v b="refs/heads/$1" '/^worktree /{wt=substr($0, length("worktree ")+1)} /^branch /{if ($2 == b) print wt}')
    if [ -z "$WT" ]; then
      echo "No worktree has branch '$1' checked out" >&2; exit 1
    fi
    echo "$WT"

# Open a branch's worktree in Cursor (or VS Code), or print its path when neither CLI is installed
[positional-arguments]
open branch:
    #!/usr/bin/env bash
    set -euo pipefail
    WT=$(just --justfile "{{ justfile() }}" worktree path "$1")
    for editor in cursor code; do
      if command -v "$editor" >/dev/null; then
        exec "$editor" "$WT"
      fi
    done
    echo "$WT"

# Copy gitignored local config (.env*, .dev.vars*) from the main checkout into this worktree; never overwrites
sync-cache:
    #!/usr/bin/env bash
    set -euo pipefail
    MAIN=$(git worktree list --porcelain | awk 'NR==1{sub(/^worktree /, ""); print}')
    HERE=$(cd -- "$(git rev-parse --show-toplevel)" && pwd -P)
    if [ "$HERE" = "$(cd -- "$MAIN" && pwd -P)" ]; then
      echo "{{ YELLOW }}Already in the main checkout, nothing to sync.{{ NORMAL }}"; exit 0
    fi
    COPIED=0
    # Listed by git rather than find, so node_modules and other ignored trees are
    # reported as single directories and never walked.
    while IFS= read -r rel; do
      case "$rel" in
        */) continue ;;
        .env* | */.env* | .dev.vars* | */.dev.vars*) ;;
        *) continue ;;
      esac
      dst="$HERE/$rel"
      if [ -f "$dst" ]; then
        diff -q "$MAIN/$rel" "$dst" >/dev/null 2>&1 \
          || echo "{{ YELLOW }}Skip $rel (differs from the main checkout; edit it by hand){{ NORMAL }}"
        continue
      fi
      mkdir -p "$(dirname "$dst")"
      cp "$MAIN/$rel" "$dst"
      echo "{{ GREEN }}Copied $rel{{ NORMAL }}"
      COPIED=$((COPIED + 1))
    done < <(git -C "$MAIN" ls-files -o -i --exclude-standard --directory)
    echo "{{ BOLD }}Cache sync done ($COPIED file(s) copied).{{ NORMAL }}"

# Run from inside a worktree after its PR merged: remove the worktree and delete its branch if the work is in origin/main
done:
    #!/usr/bin/env bash
    set -euo pipefail
    MAIN=$(git worktree list --porcelain | awk 'NR==1{sub(/^worktree /, ""); print}')
    HERE=$(cd -- "$(git rev-parse --show-toplevel)" && pwd -P)
    if [ "$HERE" = "$(cd -- "$MAIN" && pwd -P)" ]; then
      echo "{{ RED }}Error: not inside a linked worktree; use 'just worktree remove <branch>' or 'just git done'.{{ NORMAL }}"; exit 1
    fi
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ "$BRANCH" = "HEAD" ]; then
      echo "{{ RED }}Error: this worktree has a detached HEAD; remove it with 'git worktree remove'.{{ NORMAL }}"; exit 1
    fi
    just --justfile "{{ justfile() }}" worktree _teardown "$BRANCH"
    echo "Run: {{ BOLD }}cd $MAIN{{ NORMAL }}"

# Remove a branch's worktree (asks first if it has uncommitted changes) and delete the branch if its work is in origin/main
[positional-arguments]
remove branch:
    #!/usr/bin/env bash
    set -euo pipefail
    WT=$(just --justfile "{{ justfile() }}" worktree path "$1")
    if [ "$(cd -- "$WT" && pwd -P)" = "$(cd -- "$(git rev-parse --show-toplevel)" && pwd -P)" ]; then
      echo "{{ RED }}Error: that is the current worktree; run 'just worktree done' from it instead.{{ NORMAL }}"; exit 1
    fi
    just --justfile "{{ justfile() }}" worktree _teardown "$1"

# Shared by `done` and `remove`. Every git command after the removal goes through the
# main checkout, because the worktree being removed may be this process's cwd.
[positional-arguments]
_teardown branch:
    #!/usr/bin/env bash
    set -euo pipefail
    BRANCH="$1"
    WT=$(just --justfile "{{ justfile() }}" worktree path "$BRANCH")
    MAIN=$(git worktree list --porcelain | awk 'NR==1{sub(/^worktree /, ""); print}')
    FORCE=()
    if [ -n "$(git -C "$WT" status --porcelain)" ]; then
      git -C "$WT" status --short
      printf "{{ YELLOW }}Uncommitted changes in {{ BOLD }}%s{{ NORMAL }}{{ YELLOW }} will be lost. Remove anyway? [y/N]{{ NORMAL }} " "$WT"
      read -r ans || ans=""
      [[ "$ans" =~ ^[yY] ]] || { echo "Aborted; nothing removed."; exit 1; }
      FORCE=(--force)
    fi
    git -C "$MAIN" fetch --prune origin
    MERGED=1 WHY=""
    WHY=$(just --quiet --justfile "{{ justfile() }}" git _merged "$BRANCH") || MERGED=0
    git -C "$MAIN" worktree remove ${FORCE[@]+"${FORCE[@]}"} "$WT"
    echo "{{ GREEN }}Removed worktree $WT{{ NORMAL }}"
    if [ "$MERGED" = 1 ]; then
      git -C "$MAIN" branch -D "$BRANCH"
      git -C "$MAIN" push origin --delete "$BRANCH" 2>/dev/null || true
      echo "{{ GREEN }}Deleted branch $BRANCH (local + remote).{{ NORMAL }}"
    else
      echo "{{ YELLOW }}Kept branch $BRANCH: not in origin/{{ base }} ($WHY). Delete it with 'git branch -D $BRANCH' if you are sure.{{ NORMAL }}"
    fi

# Remove clean worktrees whose branch is in origin/main, then forget worktrees whose folder is gone; detached worktrees are never touched
prune:
    #!/usr/bin/env bash
    set -euo pipefail
    git fetch --prune origin
    MAIN=$(git worktree list --porcelain | awk 'NR==1{sub(/^worktree /, ""); print}')
    HERE=$(cd -- "$(git rev-parse --show-toplevel)" && pwd -P)
    # "path<TAB>branch" for every linked worktree with a branch checked out. Detached
    # worktrees (agent and review checkouts) own no branch and are left alone.
    ENTRIES=()
    while IFS= read -r line; do
      ENTRIES+=("$line")
    done < <(git worktree list --porcelain | awk -v main="$MAIN" '
      /^worktree /{ wt=substr($0, length("worktree ")+1) }
      /^branch refs\/heads\//{ if (wt != main) print wt "\t" substr($2, length("refs/heads/")+1) }
    ')
    REMOVED=() KEPT=() DIRTY=() SKIPPED=() FAILED=()
    for entry in ${ENTRIES[@]+"${ENTRIES[@]}"}; do
      wt=${entry%%$'\t'*}; br=${entry#*$'\t'}
      if [ "$br" = "{{ base }}" ]; then
        SKIPPED+=("$br [base branch]"); continue
      fi
      if [ ! -d "$wt" ]; then
        SKIPPED+=("$br [folder missing; registry entry pruned below, branch left to 'just git prune']"); continue
      fi
      if [ "$(cd -- "$wt" && pwd -P)" = "$HERE" ]; then
        SKIPPED+=("$br [current worktree]"); continue
      fi
      if ! STATUS=$(git -C "$wt" status --porcelain 2>/dev/null); then
        FAILED+=("$br [cannot read $wt]"); continue
      fi
      if [ -n "$STATUS" ]; then
        DIRTY+=("$br ($wt)"); continue
      fi
      if ! WHY=$(just --quiet --justfile "{{ justfile() }}" git _merged "$br"); then
        KEPT+=("$br [$WHY]"); continue
      fi
      # No --force: git refuses locked worktrees, which is the point of a lock.
      if git worktree remove "$wt" 2>/dev/null; then
        git branch -D "$br" >/dev/null
        REMOVED+=("$br")
      else
        FAILED+=("$br [git worktree remove refused; locked?]")
      fi
    done
    git worktree prune

    printf "\n{{ BOLD }}Summary{{ NORMAL }}\n"
    printf "  {{ GREEN }}Removed:{{ NORMAL }} %s\n" "${REMOVED[*]:-(none)}"
    printf "  {{ YELLOW }}Kept:{{ NORMAL }}    %s\n" "${KEPT[*]:-(none)}"
    printf "  {{ YELLOW }}Dirty:{{ NORMAL }}   %s\n" "${DIRTY[*]:-(none)}"
    printf "  {{ YELLOW }}Skipped:{{ NORMAL }} %s\n" "${SKIPPED[*]:-(none)}"
    printf "  {{ RED }}Failed:{{ NORMAL }}  %s\n" "${FAILED[*]:-(none)}"
