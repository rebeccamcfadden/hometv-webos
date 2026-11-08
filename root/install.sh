#!/bin/sh
# Installs HomeTV's root edition on a rooted TV (run as root, from the folder holding these scripts). Refuses unless:
# the TV is rooted with Homebrew Channel's start-up hooks, the Developer Mode app is gone, HomeTV is installed, and LG's
# Home is the flutter or web kind. Saves LG Home's own appinfo first (once, never over a mounted Home), copies the
# scripts, and adds the two start-up hooks. Takes effect at the next restart. Undo: uninstall.sh.
. "$(dirname "$0")/lib.sh"
DEVMODE_APP=${HOMETV_DEVMODE_APP:-/media/cryptofs/apps/usr/palm/applications/com.palmdts.devmode}
SRC=$(cd "$(dirname "$0")" && pwd)
fail() { echo "install: $*" >&2; say "install: refused: $*"; exit 1; }
[ "${HOMETV_SKIP_ROOT_CHECK:-}" = 1 ] || [ "$(id -u)" = 0 ] || fail "not root"
[ -d "$INITD" ] || fail "no Homebrew Channel start-up hooks ($INITD)"
[ -e "$DEVMODE_APP" ] && fail "the Developer Mode app is installed: remove it and restart first"
[ -f "$APP/index.html" ] || fail "HomeTV isn't installed ($APP)"
mkdir -p "$D/backup"
if [ ! -f "$D/backup/home-appinfo.orig.json" ]; then
  replaced && fail "LG's Home is already replaced; can't save its own appinfo"
  cp "${HOMETV_HOME_INFO:-$H/appinfo.json}" "$D/backup/home-appinfo.orig.json" || fail "can't read LG Home's appinfo"
fi
home=$(node "$SRC/decide.js" kind "$D/backup/home-appinfo.orig.json")
[ "$(node "$SRC/decide.js" takeover "$home")" = mount ] || fail "LG's Home here is '$home'; only the flutter or web Home is supported"
if [ "$SRC" != "$(cd "$D" && pwd)" ]; then
  for f in lib.sh decide.js stage-home.sh after-sam.sh undo-home.sh watchdog.sh debloat-stop.sh debloat-undo.sh \
           10-hometv-home 15-hometv-debloat uninstall.sh; do
    cp "$SRC/$f" "$D/$f" || fail "copy $f"
  done
fi
chmod 755 "$D"/*.sh "$D/10-hometv-home" "$D/15-hometv-debloat"
ln -sf "$D/10-hometv-home" "$INITD/10-hometv-home"
ln -sf "$D/15-hometv-debloat" "$INITD/15-hometv-debloat"
rm -f "$D/DISABLE"
# No start noted since this install: HomeTV's page then can't tell whether root ended, so it says nothing until the hook
# has run once (an older start's note would read as "root ended" until the restart)
rm -f "$STARTED"
say "install: done; HomeTV becomes Home at the next restart"
echo "HomeTV's root edition is installed. Restart the TV; HomeTV opens as Home."
