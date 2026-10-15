set shell := ["bash", "-euo", "pipefail", "-c"]
set working-directory := ".."

# The branch origin/HEAD points at (main unless the remote says otherwise)
base := `git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || echo main`

# just has no built-in dim constant
DIM := "\u{1b}[2m"

[private]
default:
    @just --justfile "{{ justfile() }}" --list git

# Show the branch, how far it is from its upstream and origin/main, and the working tree status
status:
    #!/usr/bin/env bash
    set -euo pipefail
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    echo "{{ BOLD }}$BRANCH{{ NORMAL }}"
    if UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null); then
      read -r BEHIND AHEAD < <(git rev-list --left-right --count "$UPSTREAM...HEAD")
      echo "  $UPSTREAM: $AHEAD ahead, $BEHIND behind"
    else
      echo "  {{ DIM }}no upstream{{ NORMAL }}"
    fi
    if [ "$BRANCH" != "{{ base }}" ] && git rev-parse --verify --quiet "origin/{{ base }}" >/dev/null; then
      read -r BEHIND AHEAD < <(git rev-list --left-right --count "origin/{{ base }}...HEAD")
      echo "  origin/{{ base }}: $AHEAD ahead, $BEHIND behind {{ DIM }}(as of the last fetch){{ NORMAL }}"
    fi
    STASHES=$(git stash list | wc -l | tr -d ' ')
    [ "$STASHES" != "0" ] && echo "  $STASHES stash entr$([ "$STASHES" = 1 ] && echo y || echo ies)"
    echo
    git status --short

# List the commits on this branch that are not on origin/main
log:
    git log --oneline --graph "origin/{{ base }}..HEAD"

# List local branches, most recently committed first, with their upstream state
branches:
    git branch -vv --sort=-committerdate

# Fetch, fast-forward the local main wherever it is checked out, and report how far this branch is behind
sync:
    #!/usr/bin/env bash
    set -euo pipefail
    git fetch --prune origin
    BASE_WT=$(git worktree list --porcelain | awk '/^worktree /{wt=substr($0, length("worktree ")+1)} $0 == "branch refs/heads/{{ base }}" {print wt}')
    if [ -n "$BASE_WT" ]; then
      git -C "$BASE_WT" merge --ff-only --quiet "origin/{{ base }}" 2>/dev/null \
        && echo "{{ GREEN }}{{ base }} is at origin/{{ base }} in $BASE_WT{{ NORMAL }}" \
        || echo "{{ YELLOW }}Could not fast-forward {{ base }} in $BASE_WT (dirty or diverged){{ NORMAL }}"
    elif git show-ref --verify --quiet "refs/heads/{{ base }}"; then
      git fetch --quiet origin "{{ base }}:{{ base }}" 2>/dev/null \
        && echo "{{ GREEN }}{{ base }} is at origin/{{ base }}{{ NORMAL }}" \
        || echo "{{ YELLOW }}Could not fast-forward {{ base }} (diverged from origin/{{ base }}){{ NORMAL }}"
    fi
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ "$BRANCH" != "{{ base }}" ] && [ "$BRANCH" != "HEAD" ]; then
      BEHIND=$(git rev-list --count "HEAD..origin/{{ base }}")
      if [ "$BEHIND" = "0" ]; then
        echo "{{ GREEN }}$BRANCH is up to date with origin/{{ base }}{{ NORMAL }}"
      else
        echo "{{ YELLOW }}$BRANCH is $BEHIND commit(s) behind origin/{{ base }}; run 'just git rebase'{{ NORMAL }}"
      fi
    fi

# Rebase the current branch onto origin/main, then offer to force-push with --force-with-lease
rebase:
    #!/usr/bin/env bash
    set -euo pipefail
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ "$BRANCH" = "{{ base }}" ] || [ "$BRANCH" = "HEAD" ]; then
      echo "{{ RED }}Error: rebase is for feature branches (currently on $BRANCH){{ NORMAL }}"; exit 1
    fi
    just --justfile "{{ justfile() }}" git sync
    BEFORE=$(git rev-parse HEAD)
    git rebase "origin/{{ base }}"
    if [ "$(git rev-parse HEAD)" = "$BEFORE" ]; then
      echo "{{ GREEN }}Already up to date, nothing to push.{{ NORMAL }}"; exit 0
    fi
    if ! git rev-parse --verify --quiet '@{upstream}' >/dev/null; then
      echo "{{ YELLOW }}No upstream yet; push with 'git push -u origin HEAD' when ready.{{ NORMAL }}"; exit 0
    fi
    printf "{{ YELLOW }}Force-push with --force-with-lease? [y/N]{{ NORMAL }} "
    read -r ans || ans=""
    case "$ans" in
      y|Y|yes|Yes|YES) git push --force-with-lease ;;
      *)               echo "{{ YELLOW }}Skipped force-push.{{ NORMAL }}" ;;
    esac

# After the PR is merged: switch to main, pull, and delete the branch you were on (local + remote)
done:
    #!/usr/bin/env bash
    set -euo pipefail
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ "$BRANCH" = "{{ base }}" ] || [ "$BRANCH" = "HEAD" ]; then
      echo "{{ RED }}Error: on $BRANCH, nothing to clean.{{ NORMAL }}"; exit 1
    fi
    if [ "$(git rev-parse --path-format=absolute --git-dir)" != "$(git rev-parse --path-format=absolute --git-common-dir)" ]; then
      echo "{{ RED }}Error: this is a linked worktree; use 'just worktree done' instead.{{ NORMAL }}"; exit 1
    fi
    if [ -n "$(git status --porcelain)" ]; then
      echo "{{ RED }}Error: uncommitted changes on $BRANCH; commit or stash them first.{{ NORMAL }}"; exit 1
    fi
    git fetch --prune origin
    if ! WHY=$(just --quiet --justfile "{{ justfile() }}" git _merged "$BRANCH"); then
      echo "{{ RED }}Error: $BRANCH is not merged into origin/{{ base }} ($WHY); nothing deleted.{{ NORMAL }}"; exit 1
    fi
    # The remote branch can be ahead of the local one, so it is checked on its own.
    REMOTE_OID=$(git rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" || true)
    if [ -n "$REMOTE_OID" ] && ! WHY=$(just --quiet --justfile "{{ justfile() }}" git _merged "$BRANCH" "$REMOTE_OID"); then
      echo "{{ RED }}Error: origin/$BRANCH has work that is not in origin/{{ base }} ($WHY); nothing deleted.{{ NORMAL }}"; exit 1
    fi
    git checkout "{{ base }}"
    git merge --ff-only "origin/{{ base }}"
    git branch -D "$BRANCH"
    if [ -z "$REMOTE_OID" ]; then
      echo "{{ GREEN }}Removed $BRANCH (origin/$BRANCH was already gone).{{ NORMAL }}"
    # The lease makes the delete fail if someone pushed to the branch after the check.
    elif git push --quiet --force-with-lease="refs/heads/$BRANCH:$REMOTE_OID" origin ":refs/heads/$BRANCH"; then
      echo "{{ GREEN }}Removed $BRANCH (local + remote).{{ NORMAL }}"
    else
      echo "{{ RED }}Removed the local $BRANCH, but could not delete origin/$BRANCH (see the error above).{{ NORMAL }}" >&2
      exit 1
    fi

# Delete local branches whose work is in origin/main (merged, or squash-merged per their GitHub PR)
prune:
    #!/usr/bin/env bash
    set -euo pipefail
    # Every decision below reads origin/{{ base }} and the `: gone]` markers, so a
    # failed fetch must stop the recipe rather than delete on stale data.
    git fetch --prune origin
    CURRENT=$(git rev-parse --abbrev-ref HEAD)
    # Branches checked out in a worktree belong to `just worktree prune`.
    IN_WORKTREE=$(git worktree list --porcelain | awk '/^branch refs\/heads\//{print substr($2, length("refs/heads/")+1)}')
    DELETED=() KEPT=() SKIPPED=() FAILED=()
    while IFS= read -r br; do
      [ -z "$br" ] || [ "$br" = "{{ base }}" ] && continue
      if [ "$br" = "$CURRENT" ]; then
        SKIPPED+=("$br [current branch]"); continue
      fi
      if printf '%s\n' "$IN_WORKTREE" | grep -qxF "$br"; then
        SKIPPED+=("$br [in a worktree]"); continue
      fi
      if ! WHY=$(just --quiet --justfile "{{ justfile() }}" git _merged "$br"); then
        KEPT+=("$br [$WHY]"); continue
      fi
      if git branch -D "$br" >/dev/null; then
        DELETED+=("$br")
      else
        FAILED+=("$br")
      fi
    done < <(git for-each-ref --format='%(refname:short)' refs/heads/)

    printf "\n{{ BOLD }}Summary{{ NORMAL }}\n"
    printf "  {{ GREEN }}Deleted:{{ NORMAL }} %s\n" "${DELETED[*]:-(none)}"
    printf "  {{ YELLOW }}Kept:{{ NORMAL }}    %s\n" "${KEPT[*]:-(none)}"
    printf "  {{ YELLOW }}Skipped:{{ NORMAL }} %s\n" "${SKIPPED[*]:-(none)}"
    printf "  {{ RED }}Failed:{{ NORMAL }}  %s\n" "${FAILED[*]:-(none)}"

# Exit 0 when every commit on the branch (or on `rev`, for eg. its remote tip) is in origin/main; otherwise print why not and exit 1
[positional-arguments]
_merged branch rev="":
    #!/usr/bin/env bash
    set -euo pipefail
    BR="$1" REV="${2:-$1}"
    if git merge-base --is-ancestor "$REV" "origin/{{ base }}" 2>/dev/null; then
      # A branch that was never pushed and has no commits of its own is new, not merged.
      if [ "$REV" != "$BR" ] || [ "$BR" = "{{ base }}" ] || git config "branch.$BR.merge" >/dev/null; then
        exit 0
      fi
      echo "nothing committed or pushed yet"; exit 1
    fi
    # Squash and rebase merges rewrite the commits, so ask GitHub whether the PR for
    # this branch merged exactly the commit being checked, into origin/{{ base }}.
    if ! command -v gh >/dev/null; then
      echo "not in origin/{{ base }}, gh not installed to check its PR"; exit 1
    fi
    set +e
    OUT=$(gh pr view "$BR" --json state,baseRefName,headRefOid,mergeCommit \
      --jq '"\(.state) \(.baseRefName) \(.headRefOid) \(.mergeCommit.oid // "-")"' 2>&1); rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      if echo "$OUT" | grep -qi 'no pull requests found'; then
        echo "no PR"
      else
        echo "PR lookup failed: $(echo "$OUT" | head -1)"
      fi
      exit 1
    fi
    read -r STATE PR_BASE HEAD_OID MERGE_OID <<<"$OUT"
    if [ "$STATE" != "MERGED" ]; then
      echo "PR $STATE"; exit 1
    fi
    if [ "$PR_BASE" != "{{ base }}" ]; then
      echo "PR merged into $PR_BASE, not {{ base }}"; exit 1
    fi
    if ! git merge-base --is-ancestor "$MERGE_OID" "origin/{{ base }}" 2>/dev/null; then
      echo "PR merge commit ${MERGE_OID:0:7} is not in origin/{{ base }} yet"; exit 1
    fi
    # Safe when the tip is the merged head or one of its ancestors.
    if git merge-base --is-ancestor "$REV" "$HEAD_OID" 2>/dev/null; then
      exit 0
    fi
    [ "$REV" = "$BR" ] && WHAT="the local branch" || WHAT="the remote branch"
    echo "PR merged at ${HEAD_OID:0:7}, but $WHAT is at $(git rev-parse --short "$REV"), which the PR never had"
    exit 1
