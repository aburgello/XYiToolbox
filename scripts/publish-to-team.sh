#!/bin/bash
# Publish a build to the team folder.
#
#   yarn release            -- version-stamps with today's date
#   yarn release 20260812   -- or an explicit YYYYMMDD
#
# Order matters and is the reason this script exists. TOOLBOX_VERSION is
# compiled into the bundle, and the panel nudges when toolbox-version.txt on
# the server is greater than the TOOLBOX_VERSION it was built with. Bump the
# text file without rebuilding and every machine nags forever -- including
# ones that just installed. So: stamp the constant, THEN build, THEN copy,
# THEN write the text file to the same value.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEAM="/Volumes/newmedia/_Motion/MotionAssets/_Scripts/Team_Folder"
DEST="$TEAM/_zxp/com.xyi.toolbox"
SRC="$ROOT/dist/cep"
VERSION_TS="$ROOT/src/js/main/TeamDroplet.tsx"
EXPECT_ID="com.xyi.toolbox"

VERSION="${1:-$(date +%Y%m%d)}"

step() { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
die()  { printf "\n\033[1;31mFAILED: %s\033[0m\n" "$1" >&2; exit 1; }

# --- preflight, before touching anything ---------------------------------
[[ "$VERSION" =~ ^[0-9]{8}$ ]] || die "Version must be 8 digits YYYYMMDD, got '$VERSION'.
A dotted form like 2026.08 string-compares as OLDER than 20260804 and the
nudge would never fire."

[ -d "$TEAM" ] || die "The newmedia server isn't mounted — nothing would be published."
[ -f "$VERSION_TS" ] || die "Can't find TeamDroplet.tsx at $VERSION_TS"

# --- what is actually about to be published -------------------------------
#
# THIS SCRIPT SHIPS THE WORKING TREE, NOT A COMMIT. Whatever is checked out
# right now is what gets built and copied to the team folder, so releasing from
# a feature branch puts that branch on every artist's machine -- and a panel is
# not something anyone opts into, it is just there the next time AE starts.
#
# The two checks below are the difference between "I published master" and "I
# published whatever I happened to be testing at the time".
#
# BRANCH. Overridable, because there is a legitimate case for it -- a hotfix
# built from a branch while master is mid-something -- but it has to be said out
# loud rather than being the thing that happens when you forget to switch back:
#
#     PUBLISH_ANY_BRANCH=1 yarn release
#
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [ -z "$BRANCH" ]; then
  die "Not a git checkout — can't tell what would be published."
fi
if [ "$BRANCH" = "HEAD" ]; then
  die "HEAD is detached, so there is no branch to publish from.
Check out master first: git checkout master"
fi
if [ "$BRANCH" != "master" ] && [ "${PUBLISH_ANY_BRANCH:-}" != "1" ]; then
  die "On branch '$BRANCH', not master.

Publishing sends the WORKING TREE to the team folder, so this would put
'$BRANCH' on everyone's machine. Merge it to master first, or, if you
really mean to publish this branch:

    PUBLISH_ANY_BRANCH=1 yarn release"
fi

# UNCOMMITTED WORK. Not pedantry: a published build with no commit behind it
# cannot be reproduced, reverted, or even identified later -- "which version is
# the team on" stops having an answer.
#
# TeamDroplet.tsx is excluded because THIS SCRIPT edits it, in step 1 below, and
# does not commit the stamp. Refusing on the file the script itself dirties
# would mean every release failed the one after it.
DIRTY="$(git -C "$ROOT" status --porcelain -- . ':(exclude)src/js/main/TeamDroplet.tsx' 2>/dev/null)"
if [ -n "$DIRTY" ] && [ "${PUBLISH_DIRTY:-}" != "1" ]; then
  printf "\n%s\n" "$DIRTY" >&2
  die "Uncommitted changes (listed above).

These would be published without existing in any commit. Commit them, or:

    PUBLISH_DIRTY=1 yarn release"
fi

# UNPUSHED COMMITS are a NOTE, not a refusal -- the build is still reproducible
# from a local commit, and requiring a push would make releasing depend on
# GitHub being reachable.
UPSTREAM="$(git -C "$ROOT" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || echo "")"
if [ -n "$UPSTREAM" ]; then
  AHEAD="$(git -C "$ROOT" rev-list --count "$UPSTREAM..HEAD" 2>/dev/null || echo 0)"
  if [ "${AHEAD:-0}" -gt 0 ]; then
    echo "Note: $AHEAD commit(s) on $BRANCH are not pushed to $UPSTREAM yet."
    echo "The build is fine; nobody else can see the source it was built from."
  fi
fi

CURRENT="$(grep -o 'TOOLBOX_VERSION = "[0-9]*"' "$VERSION_TS" | grep -o '[0-9]*')"
if [ "$VERSION" \< "$CURRENT" ] || [ "$VERSION" = "$CURRENT" ]; then
  echo "Note: current build is stamped $CURRENT, publishing as $VERSION."
  echo "Anyone already on $CURRENT will not see an update nudge."
fi

# --- 1. stamp -------------------------------------------------------------
step "Stamping version $VERSION"
sed -i '' "s/TOOLBOX_VERSION = \"[0-9]*\"/TOOLBOX_VERSION = \"$VERSION\"/" "$VERSION_TS"
grep -q "TOOLBOX_VERSION = \"$VERSION\"" "$VERSION_TS" || die "Version stamp didn't apply."
echo "    $VERSION_TS"

# --- 2. build -------------------------------------------------------------
step "Building"
( cd "$ROOT" && yarn build ) || die "Build failed — nothing was published."

# --- 3. verify the build before it goes anywhere --------------------------
step "Verifying build"
[ -f "$SRC/CSXS/manifest.xml" ] || die "No manifest in $SRC"
[ -f "$SRC/main/index.html" ]   || die "No panel in $SRC"

BUILT_ID="$(grep -o 'ExtensionBundleId="[^"]*"' "$SRC/CSXS/manifest.xml" | cut -d'"' -f2)"
[ "$BUILT_ID" = "$EXPECT_ID" ] || die "Built id is '$BUILT_ID', expected '$EXPECT_ID'.
Check the id in cep.config.ts — publishing this would register a second
extension and leave people with two panels."

grep -q "$VERSION" "$SRC"/assets/main-*.cjs || die "Version $VERSION isn't in the bundle — the stamp didn't compile in."
echo "    id $BUILT_ID, version $VERSION baked in"

# --- 4. publish -----------------------------------------------------------
step "Copying to team folder"
mkdir -p "$DEST"
# --delete matters: Vite hashes bundle filenames, so a merge would pile up
# every old main-*.cjs forever.
rsync -rlt --delete --exclude '.DS_Store' --exclude '._*' "$SRC/" "$DEST/" \
  || die "Copy to $DEST failed."
diff -r "$SRC" "$DEST" >/dev/null || die "Published copy doesn't match the build."
echo "    $DEST"

# --- 5. flip the switch ---------------------------------------------------
# Last, so the nudge only ever points at files that are already in place.
step "Announcing $VERSION"
printf '%s' "$VERSION" > "$TEAM/toolbox-version.txt"
echo "    $TEAM/toolbox-version.txt"

printf "\n\033[1;32m==> Published %s\033[0m\n" "$VERSION"
echo "Everyone's panel will now show the update nudge."
echo "They re-run the installer from _zxp — no admin needed."
