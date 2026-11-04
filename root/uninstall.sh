#!/bin/sh
# Removes HomeTV's root edition: LG's Home back now (undo-home.sh, which also lifts the debloat), the start-up hooks
# gone, the HomeTV folder deleted. HomeTV the app and Homebrew Channel stay (uninstall them from Homebrew Channel; the
# full unroot is LG's Reset to Initial Settings, docs/root-plan.md). A restart afterwards brings back anything still
# in memory. From lasharor's uninstall.sh (MIT).
. "$(dirname "$0")/lib.sh"
INITD=${HOMETV_INITD:-/var/lib/webosbrew/init.d}
sh "$D/undo-home.sh" </dev/null || echo "uninstall: LG's Home comes back at the next restart" >&2
rm -f "$INITD/10-hometv-home" "$INITD/15-hometv-debloat"
case "$D" in */hometv) rm -rf "$D" ;; *) echo "uninstall: unexpected folder $D, left in place" >&2 ;; esac
echo "HomeTV's root edition is removed. Restart the TV."
