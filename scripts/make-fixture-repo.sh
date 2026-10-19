#!/usr/bin/env bash
# Creates a realistic demo repository for manual / visual testing of Adar.
#   scripts/make-fixture-repo.sh <target-dir> [--conflict]
# Produces <target-dir>/demo (working repo) and <target-dir>/origin.git (bare remote) with:
# several authors, merged and unmerged feature branches, tags (light + annotated), a stash,
# a remote-only branch, local commits ahead of origin, and staged/unstaged/untracked changes.
# With --conflict the demo repo is left in the middle of a merge with conflicts.
set -euo pipefail

TARGET="${1:?usage: make-fixture-repo.sh <target-dir> [--conflict]}"
CONFLICT="${2:-}"
rm -rf "$TARGET/demo" "$TARGET/origin.git"
mkdir -p "$TARGET"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

git init -q --bare -b main "$TARGET/origin.git"
git init -q -b main "$TARGET/demo"
cd "$TARGET/demo"
git config user.name "Ana García"
git config user.email "ana@example.com"
git config commit.gpgsign false
git remote add origin "$TARGET/origin.git"

T=1760000000
commit_as() { # name email message
  T=$((T + 3600))
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" \
    GIT_AUTHOR_DATE="@$T +0200" GIT_COMMITTER_DATE="@$T +0200" git commit -q -m "$3" ${4:+-m "$4"}
}
ANA=("Ana García" "ana@example.com")
LUIS=("Luis Pérez" "luis@example.com")
MARTA=("Marta Ruiz" "marta@example.com")
JON=("Jon Etxeberria" "jon@example.com")

mkdir -p src docs
printf '# Demo\n\nA demo project for Adar.\n' > README.md
printf 'node_modules\ndist\n' > .gitignore
git add -A && commit_as "${ANA[@]}" "Initial commit"

for i in 1 2 3; do
  printf 'export const v%s = %s\n' "$i" "$i" >> src/values.ts
  git add -A && commit_as "${LUIS[@]}" "Add value v$i" "Part of the values series ($i/3)."
done
git tag v0.1.0

# feature/login — merged with --no-ff
git checkout -q -b feature/login
printf 'export function login(user: string) {\n  return user.length > 0\n}\n' > src/login.ts
git add -A && commit_as "${MARTA[@]}" "Add login function"
printf '\nexport function logout() {}\n' >> src/login.ts
git add -A && commit_as "${MARTA[@]}" "Add logout"
git checkout -q main
printf '\n## Install\n\nnpm install\n' >> README.md
git add -A && commit_as "${ANA[@]}" "Document installation"
T=$((T + 3600))
GIT_AUTHOR_DATE="@$T +0200" GIT_COMMITTER_DATE="@$T +0200" git merge -q --no-ff feature/login -m "Merge branch 'feature/login'"

# bugfix/crash — fast-forward merged
git checkout -q -b bugfix/crash
printf 'export const safe = true\n' > src/safe.ts
git add -A && commit_as "${JON[@]}" "Fix crash on empty input"
git checkout -q main
git merge -q --ff-only bugfix/crash

# release/1.0 + annotated tag
git checkout -q -b release/1.0
sed -i.bak 's/A demo project/A demo project (1.0)/' README.md && rm README.md.bak
git add -A && commit_as "${ANA[@]}" "Bump version to 1.0"
T=$((T + 60))
GIT_COMMITTER_DATE="@$T +0200" git tag -a v1.0.0 -m "Release 1.0.0"
git checkout -q main

for i in 4 5 6 7; do
  printf 'export const v%s = %s\n' "$i" "$i" >> src/values.ts
  who=("${LUIS[@]}"); [ $((i % 2)) -eq 0 ] && who=("${ANA[@]}")
  git add -A && commit_as "${who[@]}" "Add value v$i"
done
git push -q -u origin main release/1.0 --tags

# remote-only branch "experiment"
git checkout -q -b experiment
printf 'experimental\n' > docs/experiment.md
git add -A && commit_as "${JON[@]}" "Try an experimental idea"
git push -q origin experiment
git checkout -q main
git branch -q -D experiment

# feature/graph — unmerged, 3 commits
git checkout -q -b feature/graph
for i in 1 2 3; do
  mkdir -p docs; printf 'lane %s\n' "$i" >> docs/graph.md
  git add -A && commit_as "${MARTA[@]}" "Graph work part $i"
done
git checkout -q main

# local commit ahead of origin/main
printf 'export const v8 = 8\n' >> src/values.ts
git add -A && commit_as "${ANA[@]}" "Add value v8 (not pushed)"

# stash
mkdir -p docs; printf 'stashed change\n' >> docs/notes.md
git add docs/notes.md
git stash push -q -m "Half-done notes"

if [ "$CONFLICT" = "--conflict" ]; then
  git checkout -q -b conflicting
  sed -i.bak 's/^# Demo$/# Demo (conflicting title)/' README.md && rm README.md.bak
  git add -A && commit_as "${JON[@]}" "Change title on branch"
  git checkout -q main
  sed -i.bak 's/^# Demo$/# Demo (main title)/' README.md && rm README.md.bak
  git add -A && commit_as "${ANA[@]}" "Change title on main"
  git merge conflicting -m "Merge conflicting" >/dev/null 2>&1 || true
else
  # working tree changes: staged, unstaged and untracked
  printf '\n## Usage\n\nRun it.\n' >> README.md
  git add README.md
  printf 'export const v9 = 9\n' >> src/values.ts
  printf 'console.log("hello")\n' > src/new-file.ts
fi

echo "Fixture ready: $TARGET/demo"
