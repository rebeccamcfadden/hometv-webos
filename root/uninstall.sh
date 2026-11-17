#!/bin/sh
# Removes HomeTV's root edition: LG's Home back now (undo-home.sh, which also lifts the debloat), the start-up hooks
# gone, the HomeTV folder deleted. HomeTV the app and Homebrew Channel stay (uninstall them from Homebrew Channel; the
# full unroot is LG's Reset to Initial Settings, docs/root-plan.md). A restart afterwards brings back anything still
# in memory. When LG's Home couldn't be put back now (HomeTV's mount busy, or a mount that isn't HomeTV's), the hooks
# still go and "Use LG's Home" is set, but the folder is kept: HomeTV's mount reads from it, and it holds LG Home's
# saved appinfo; run this again after a restart. From lasharor's uninstall.sh and its "Native Home restoration safety"
# (MIT, read at 2debe62).
. "$(dirname "$0")/lib.sh"
if ! sh "$D/undo-home.sh" </dev/null; then
  rm -f "$INITD/10-hometv-home" "$INITD/15-hometv-debloat"
  echo "uninstall: LG's Home isn't back yet; the start-up hooks are gone, so it is after a restart. The HomeTV folder ($D) is kept: restart the TV, then run this again." >&2
  exit 1
fi
# HomeTV's own watchdog only (its path in the command line); no other process is touched
pkill -f "[h]ometv/watchdog.sh" 2>/dev/null
rm -f "$INITD/10-hometv-home" "$INITD/15-hometv-debloat"
case "$D" in */hometv) rm -rf "$D" ;; *) echo "uninstall: unexpected folder $D, left in place" >&2 ;; esac
echo "HomeTV's root edition is removed. Restart the TV."
