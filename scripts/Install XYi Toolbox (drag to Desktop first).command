#!/bin/bash
# XYi Toolbox installer -- double-click from Finder.
#
# Installs to the PER-USER CEP folder (~/Library/...), which needs no admin
# rights. The only step that can ask for a password is removing a leftover
# system-wide install from the old ZXP installer, and that happens once ever.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="/Volumes/newmedia/_Motion/MotionAssets/_Scripts/Team_Folder/_zxp"

# The newmedia share's ACLs grant no 'execute' to anyone, so this file cannot
# be double-clicked in place -- it has to be copied to the Desktop first,
# which is where it will usually be running from. Look for the payload next
# to the script (running in place via `bash <path>`), then fall back to the
# server, so a Desktop copy still finds it.
PAYLOAD="$SCRIPT_DIR/com.xyi.toolbox"
[ -d "$PAYLOAD" ] || PAYLOAD="$SERVER_DIR/com.xyi.toolbox"

USER_EXT="$HOME/Library/Application Support/Adobe/CEP/extensions"
TARGET="$USER_EXT/com.xyi.toolbox"
OLD_USER="$USER_EXT/com.xyi.ovlibrary"
OLD_SYS="/Library/Application Support/Adobe/CEP/extensions/com.xyi.ovlibrary"

echo
echo "===================================="
echo "  XYi Toolbox — installer"
echo "===================================="
echo

fail() { echo; echo "FAILED: $1"; echo; echo "Press any key to close."; read -r -n 1; exit 1; }

# --- 1. payload present? ------------------------------------------------
if [ ! -d "$PAYLOAD" ]; then
  if [ ! -d "/Volumes/newmedia" ]; then
    fail "The 'newmedia' server is not connected.
Connect to it in the Finder (Go > Connect to Server), then run this again."
  fi
  fail "Can't find the XYi Toolbox files on the server.
Expected them here:
  $SERVER_DIR/com.xyi.toolbox
Let Antonio know if that folder is missing."
fi

# --- 2. After Effects must be closed ------------------------------------
if pgrep -q -f "Adobe After Effects"; then
  echo "After Effects is currently running."
  echo "Quit it first, then press RETURN to continue (or Ctrl-C to cancel)."
  read -r
  if pgrep -q -f "Adobe After Effects"; then
    fail "After Effects is still running. Quit it and run this again."
  fi
fi

# --- 3. enable unsigned extensions (per-user, no admin) -----------------
echo "[1/4] Allowing unsigned extensions..."
for v in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 2>/dev/null
done
killall cfprefsd 2>/dev/null
echo "      done."

# --- 4. clear old ovlibrary installs -------------------------------------
# Nothing below asks for a password. Most people here are standard domain
# users with no admin rights at all, so a sudo prompt would just be a dead
# end that hangs the installer.
echo "[2/4] Removing the old 'ovlibrary' version..."
NEEDS_IT=0

if [ -L "$OLD_USER" ]; then
  rm "$OLD_USER" && echo "      removed old link in your home folder."
elif [ -d "$OLD_USER" ]; then
  rm -rf "$OLD_USER" && echo "      removed old copy in your home folder."
fi

if [ -e "$OLD_SYS" ]; then
  if [ -w "$(dirname "$OLD_SYS")" ]; then
    # Rare: only if this account can write /Library/.../extensions.
    rm -rf "$OLD_SYS" && echo "      removed the old system-wide copy."
  elif [ -w "$OLD_SYS" ]; then
    # Usual no-admin path. We can't delete the folder (that needs write
    # access on its parent), but we own the folder so we can empty it.
    # CEP only treats a folder as an extension if it can read
    # CSXS/manifest.xml, so an emptied folder is skipped entirely --
    # just as effective as deleting it, and needs no password.
    # Use rm -rf per entry, not -delete: on a real ZXP install CSXS is a
    # non-empty directory and -delete has rmdir semantics, so it would fail
    # and silently leave the manifest in place. rm never follows symlinks,
    # so links pointing at a dev build folder lose only the link.
    find "$OLD_SYS" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null
    if [ -f "$OLD_SYS/CSXS/manifest.xml" ]; then
      NEEDS_IT=1
    else
      echo "      disabled the old system-wide copy."
    fi
  else
    NEEDS_IT=1
  fi
else
  echo "      nothing to remove."
fi

[ "$NEEDS_IT" = "1" ] && echo "      could not remove it — see the note at the end."

# --- 5. install ----------------------------------------------------------
echo "[3/4] Installing XYi Toolbox..."
mkdir -p "$USER_EXT" || fail "Could not create $USER_EXT"

# A symlink here means this is a developer machine pointing at a live build
# folder. Never rsync --delete into that: it would wipe the build directory.
if [ -L "$TARGET" ]; then
  echo
  echo "      NOTE: com.xyi.toolbox is a symlink to a local build folder,"
  echo "      so this looks like a development machine. Leaving it alone."
  echo "      Nothing was overwritten."
  echo
  echo "Press any key to close."
  read -r -n 1
  exit 0
fi

rsync -rlt --delete --exclude '.DS_Store' --exclude '._*' \
  "$PAYLOAD/" "$TARGET/" || fail "Could not copy files to $TARGET"
echo "      done."

# --- 6. verify -----------------------------------------------------------
echo "[4/4] Checking..."
[ -f "$TARGET/CSXS/manifest.xml" ] || fail "Install looks incomplete — manifest missing."
[ -f "$TARGET/main/index.html" ]  || fail "Install looks incomplete — panel missing."
echo "      looks good."

echo
echo "===================================="
echo "  Installed."
echo "===================================="
echo
echo "  Now open After Effects and go to:"
echo "     Window > Extensions > XYi Toolbox"
echo
echo "  The panel will not be in your saved workspace the first time,"
echo "  so add it from that menu, arrange it how you like, then use"
echo "     Window > Workspace > Save Changes to this Workspace"
echo "  and it will come back automatically from then on."
echo

if [ "$NEEDS_IT" = "1" ]; then
  echo "------------------------------------"
  echo "  ONE THING TO REPORT"
  echo "------------------------------------"
  echo
  echo "  An old copy of the toolbox is installed system-wide and this"
  echo "  account cannot remove it. The new version works fine, but you"
  echo "  will see TWO 'XYi Toolbox' entries under Window > Extensions."
  echo
  echo "  Use the one that opens correctly, and send this line to IT or"
  echo "  to Antonio — it is a one-off fix:"
  echo
  echo "      sudo rm -rf \"$OLD_SYS\""
  echo
fi

echo "Press any key to close."
read -r -n 1
