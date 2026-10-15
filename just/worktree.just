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
    if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
      git worktree add "$WT" "$BRANCH"
    else
      # show-ref only sees local refs, so look for the branch on origin too; otherwise
      # a branch that only exists remotely would be re-created off origin/{{ base }}.
      # ls-remote exits 2 only when the branch is confirmed absent; any other failure
      # means origin could not be asked, and guessing would fork the wrong branch.
      set +e
      git ls-remote --exit-code --heads origin "refs/heads/$BRANCH" >/dev/null; rc=$?
      set -e
      if [ "$rc" = 0 ]; then
        git fetch --quiet origin "$BRANCH:refs/remotes/origin/$BRANCH"
        git worktree add "$WT" -b "$BRANCH" "origin/$BRANCH"
      elif [ "$rc" = 2 ]; then
        # --no-track: tracking origin/{{ base }} would make a plain `git push` refuse.
        git worktree add --no-track "$WT" -b "$BRANCH" "origin/{{ base }}"
      else
        echo "{{ RED }}Error: could not check whether origin has $BRANCH; nothing created.{{ NORMAL }}" >&2
        exit 1
      fi
    fi
    echo "{{ YELLOW }}Installing dependencies in the new worktree...{{ NORMAL }}"
    if ! (cd "$WT" && yarn install --immutable && yarn prepare); then
      echo "{{ RED }}Worktree created at $WT, but installing dependencies failed.{{ NORMAL }}" >&2
      echo "{{ YELLOW }}Finish setup with: cd $WT && yarn install --immutable && yarn prepare{{ NORMAL }}" >&2
      exit 1
    fi
    echo "{{ GREEN }}Worktree ready at $WT{{ NORMAL }}"
    echo "cd \"\$(just worktree path $BRANCH)\""

# Like `add`, but moves your uncommitted changes (including untracked files) into the new worktree
[positional-arguments]
start branch:
    #!/usr/bin/env bash
    set -euo pipefail
    BRANCH=$(git check-ref-format --branch "$1")
    MAIN=$(git worktree list --porcelain | awk 'NR==1{sub(/^worktree /, ""); print}')
    WT="$(dirname "$MAIN")/$(basename "$MAIN")--${BRANCH//\//-}"
    STASH_OID=""
    if [ -n "$(git status --porcelain)" ]; then
      echo "{{ YELLOW }}Stashing uncommitted changes...{{ NORMAL }}"
      # The stash is shared by every worktree of this clone, so another terminal can
      # push onto it meanwhile. A unique message pins down which entry is ours.
      MSG="worktree start: moving to $BRANCH ($$-$(date +%s))"
      git stash push -u -m "$MSG"
      STASH_OID=$(git stash list --format='%H%x09%gs' | awk -F'\t' -v m="$MSG" 'index($2, m) {print $1; exit}')
      if [ -z "$STASH_OID" ]; then
        echo "{{ RED }}Error: could not find the stash entry just created ('$MSG'); check 'git stash list'.{{ NORMAL }}" >&2
        exit 1
      fi
    fi
    if ! just --justfile "{{ justfile() }}" worktree add "$BRANCH"; then
      if [ -n "$STASH_OID" ]; then
        if [ -d "$WT" ]; then
          echo "{{ RED }}Your changes are still stashed as ${STASH_OID:0:7}. Once setup is done, apply them with:{{ NORMAL }}" >&2
          echo "{{ YELLOW }}  git -C $WT stash apply $STASH_OID{{ NORMAL }}" >&2
        else
          echo "{{ RED }}Worktree not created; your changes are stashed as ${STASH_OID:0:7}. Get them back here with:{{ NORMAL }}" >&2
          echo "{{ YELLOW }}  git stash apply $STASH_OID{{ NORMAL }}" >&2
        fi
        echo "{{ YELLOW }}Then drop the '$MSG' entry from 'git stash list'.{{ NORMAL }}" >&2
      fi
      exit 1
    fi
    [ -n "$STASH_OID" ] || exit 0
    if git -C "$WT" stash apply "$STASH_OID"; then
      # Look the entry up again: its stash@{n} index shifts if others were pushed since.
      REF=$(git stash list --format='%gd %H' | awk -v o="$STASH_OID" '$2 == o {print $1; exit}')
      [ -n "$REF" ] && git stash drop --quiet "$REF"
      echo "{{ GREEN }}Moved your changes to $WT{{ NORMAL }}"
    else
      # Applying again would re-apply whatever already landed, so point at the entry instead.
      echo "{{ RED }}Your changes did not apply cleanly in $WT; the stash entry ${STASH_OID:0:7} is kept.{{ NORMAL }}" >&2
      echo "{{ YELLOW }}Check 'git -C $WT status'. Once everything you need is in place, drop the '$MSG' entry from 'git stash list'.{{ NORMAL }}" >&2
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
    # The base branch always "passes" the merge check against itself, so without this
    # its checkout, the local branch and origin/{{ base }} would all be deleted.
    if [ "$BRANCH" = "{{ base }}" ]; then
      echo "{{ RED }}Error: {{ base }} is the base branch; nothing removed. To drop just its checkout: git worktree remove $WT{{ NORMAL }}" >&2
      exit 1
    fi
    if [ "$(cd -- "$WT" && pwd -P)" = "$(cd -- "$MAIN" && pwd -P)" ]; then
      echo "{{ RED }}Error: $WT is the main checkout, not a linked worktree; nothing removed.{{ NORMAL }}" >&2
      exit 1
    fi
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
    # The remote branch can be ahead of the local one, so it is checked on its own.
    # Both checks run before the removal, which may delete this justfile.
    REMOTE_OID=$(git -C "$MAIN" rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" || true)
    if [ "$MERGED" = 1 ] && [ -n "$REMOTE_OID" ]; then
      WHY=$(just --quiet --justfile "{{ justfile() }}" git _merged "$BRANCH" "$REMOTE_OID") \
        || { MERGED=0; WHY="origin/$BRANCH: $WHY"; }
    fi
    git -C "$MAIN" worktree remove ${FORCE[@]+"${FORCE[@]}"} "$WT"
    echo "{{ GREEN }}Removed worktree $WT{{ NORMAL }}"
    if [ "$MERGED" = 1 ]; then
      git -C "$MAIN" branch -D "$BRANCH"
      if [ -z "$REMOTE_OID" ]; then
        echo "{{ GREEN }}Deleted branch $BRANCH (origin/$BRANCH was already gone).{{ NORMAL }}"
      # The lease makes the delete fail if someone pushed to the branch after the check.
      elif git -C "$MAIN" push --quiet --force-with-lease="refs/heads/$BRANCH:$REMOTE_OID" origin ":refs/heads/$BRANCH"; then
        echo "{{ GREEN }}Deleted branch $BRANCH (local + remote).{{ NORMAL }}"
      else
        echo "{{ RED }}Deleted the local $BRANCH, but could not delete origin/$BRANCH (see the error above).{{ NORMAL }}" >&2
        exit 1
      fi
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
