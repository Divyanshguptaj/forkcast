# Git history cleanup plan (Google Places recordings)

Status: **investigated and dry-run only. Nothing has been rewritten, force-pushed, deleted or made public.** Run these steps only after explicit approval.

## 1. What is in the history

Repository: `Divyanshguptaj/restaurant-agent`, one branch (`main`), no tags, 10 commits, remote `origin/main` identical to local.

| Content | Files | Commits that contain it |
|---|---|---|
| Recorded Places output for real restaurants (place ids `ChIJ...`, names, addresses, coordinates, ratings and review counts, opening hours, Maps URLs), plus the extracted menus | `fixtures/phase6/veg-italian-dinner-30.json`, `fixtures/phase6/vegan-lunch-15.json`, `src/mocks/replay/recorded-barcelona.json` | `f93cf27` (Phase 5/6) and `55ac757` (Phase 7). Removed from the tree in `a6089ed` (Phase 8). |
| Real restaurant names with real ratings and review counts in demo data and test expectations (from a Phase 2 smoke test) | `src/mocks/replay/scenarios.ts`, `src/mocks/replay/resultPreview.ts`, `tests/components/research.test.tsx`, `tests/unit/agent-reducer.test.ts`, `tests/unit/shortlist.test.ts`, `tests/unit/resolver-units.test.ts`, later also `tests/components/recommendations.test.tsx`, `tests/unit/ranking.test.ts`, `tests/e2e/forkcast.spec.ts` | `8c2d436` (Phase 3) through `55ac757` |
| Screenshots of the UI rendered with that data | `docs/screenshots/*.png` (18 files across versions) | `8c2d436`, `47c5d02`, `f1e07cf`, `f93cf27`, `55ac757`, `a6089ed` |

Credentials: none found. A scan of every added line in every commit for Google, Gemini and Tavily key patterns and `*_API_KEY=` values found nothing, and the only environment file ever tracked is `.env.example` (empty values). **No key rotation is required by this cleanup.**

Not Places data, left alone: provider client code and tests (`src/server/providers/places/*`, `tests/helpers/places.ts`), which use fictional values, and menu wording copied from restaurants' own websites.

## 2. Is a rewrite necessary?

- While the repository is **private and unshared**, no rewrite is necessary: the data is only visible to you and to GitHub.
- Before making it **public**, or sharing it with anyone who could clone it, yes: Google's terms restrict storing Places content, and removing files from the current tree does not remove them from history.
- Two ways to get a clean public history:
  - **Option A, rewrite and force-push `main`** (below). Keeps the 10-commit story. Rewrites commit hashes (the dry run changed 9 of 10).
  - **Option B, publish a new repository** from the cleaned clone (or a single squashed commit) and leave the old private repository as an archive. No force-push, no cached-SHA concerns on the new repository. Recommended if the repository has not been shared.

## 3. Dry run already performed

On a throwaway clone (the real repository and `origin` were not touched):

```
git clone --no-local <repo> dryrun
git filter-repo --invert-paths --path docs/screenshots/ \
  --replace-text <local expressions file> \
  --blob-callback 'if b"ChIJ" in blob.data: blob.skip()'
```

Result: all 10 commits kept (hashes changed), single branch, no tags; **zero matches** for the place-id prefix, the five restaurant names and the real review counts across every revision; the three recording files no longer exist in any commit that contained place ids; the current synthetic versions of the fixtures and demo data are untouched; the rewritten HEAD tree is identical to the original HEAD apart from line endings and the removed screenshots; `vitest` passes on the rewritten tree (683 tests). `git-filter-repo` was already installed (`git filter-repo --version`: `a40bce548d2c`).

The replacement rules live in a **local file outside the repository** (`C:\Users\lucky\Desktop\React\forkcast-history-cleanup\expressions.txt`) because they necessarily contain the real names. Do not commit that file.

## 4. Exact steps (after approval)

```bash
cd /c/Users/lucky/Desktop/React/restaurant-agent

# 0. Preconditions
git status --short            # must be empty (commit or stash Phase 9 first)
git fetch origin && git diff origin/main --stat   # must be empty

# 1. Backups (keep until you have verified the new history)
git bundle create ../restaurant-agent-backup-$(date +%F).bundle --all
git clone --mirror . ../restaurant-agent-backup.git
cp -r docs/screenshots ../screenshots-backup

# 2. Rewrite in a FRESH clone, never in your working copy
git clone --no-local . ../restaurant-agent-clean
cd ../restaurant-agent-clean
git filter-repo \
  --invert-paths --path docs/screenshots/ \
  --replace-text ../forkcast-history-cleanup/expressions.txt \
  --blob-callback 'if b"ChIJ" in blob.data: blob.skip()'

# 3. Put the current (synthetic) screenshots back as one new commit
mkdir -p docs/screenshots && cp ../screenshots-backup/*.png docs/screenshots/
git add docs/screenshots
git commit -m "Restore synthetic UI screenshots"
```

### Verification (run all of these; every check must pass)

```bash
# no place ids, real names or real counts in ANY revision
for c in $(git rev-list --all); do
  git grep -I -l -E 'ChIJ|ratingCount: (9669|9527|2465|876|4980)' $c
done                                   # prints nothing
# the five real names (use the names from your local expressions file)
# files that should no longer exist anywhere in history
git log --all --name-only --format= | sort -u | grep -E 'vegan-lunch-15|screenshots'   # only the restored png files
# history shape
git log --oneline | wc -l              # 11 (10 rewritten + the screenshots commit)
git branch -a; git tag                 # only main, no tags
# code still works
npm ci && npm run typecheck && npm run lint && npm test && npm run build
git count-objects -vH                  # size sanity check
```

### Publishing the result

**Option A, force-push `main` of the existing repository** (needs explicit approval):

```bash
git remote add origin https://github.com/Divyanshguptaj/restaurant-agent.git
git push --force-with-lease origin main
```

**Option B, new repository** (no force-push):

```bash
gh repo create Divyanshguptaj/forkcast --private --source=. --remote=origin --push
# make it public only after you have reviewed it
```

## 5. Risks and caveats

- Every commit hash changes (Option A). Anyone with a clone, and any link to an old commit, breaks; they must re-clone. You are the only contributor, so this is low impact.
- A force-push rewrites the remote branch irreversibly; keep the bundle and mirror backups until verified. `--force-with-lease` protects against overwriting commits you have not seen.
- GitHub can keep old commits reachable by SHA (cached views, forks, pull-request refs) after a force-push. This repository has no forks or pull requests, but a support request to purge cached objects is the only way to be certain. Option B avoids this on the new repository.
- Local data on your machine still exists in `fixtures/raw/` (git-ignored) and in the backups; keep them private.
- `filter-repo` removes the `origin` remote from the clone by design; the steps above re-add it.
- The replacement rules rewrite the real names to the same fictional names the tree already uses, so tests and screenshots stay consistent.
- The rewrite does not change the code history otherwise, and it was verified only on a dry-run clone of commit `a6089ed`; Phase 9 commits made before the real rewrite are included automatically because the rewrite runs on a fresh clone of the latest state.
