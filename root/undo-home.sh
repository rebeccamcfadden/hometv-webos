#!/bin/sh
# Puts LG's Home back (docs/root-plan.md, The way back):
#   temp        now, until the next restart only (level 0: HomeTV's Home pressed three times, the watchdog)
#   (none)      now and for good (level 1 from the laptop; uninstall.sh)
#   at-restart  for good from the next restart; nothing in memory changes now (level 1 from HomeTV's own setting,
#               whose page is the Home being replaced)
# For good = HomeTV's two start-up hooks removed from Homebrew Channel's folder, and DISABLE written (the hooks and the
# watchdog honour it, should a hook ever be linked again). Nothing of HomeTV runs at the next start; its folder, the app
# and root stay. Undone by install.sh (hometv-lg root <tv address> --home-again), which links the hooks again and
# removes DISABLE. Lifts the debloat first: LG's Home doesn't start without the ad services it stops. Unmounts only
# HomeTV's own mount over LG's Home (lib.sh ours); a mount there that isn't HomeTV's, or one still busy, is left in place
# and it says so (exit 1), so LG's Home is never claimed back when it isn't. Kills no process but LG Home's renderer.
# From lasharor's undo-home.sh and its "Native Home restoration safety" (MIT, read at 2debe62), the mount way only.
. "$(dirname "$0")/lib.sh"
case "$1" in
  temp|at-restart|"") ;;
  *) echo "usage: undo-home.sh [temp|at-restart]" >&2; exit 2 ;;
esac
if [ "$1" != temp ]; then
  touch "$D/DISABLE"
  rm -f "$INITD/10-hometv-home" "$INITD/15-hometv-debloat"
  say "undo-home: LG's Home for good: HomeTV's start-up hooks removed, DISABLE written"
fi
LASTAPP=${HOMETV_LASTAPP:-/var/luna/preferences/bootd_last_foreground_app_id.json}
grep -q "$APP_ID" "$LASTAPP" 2>/dev/null && echo '{"lastAppId":"com.webos.app.home"}' > "$LASTAPP"
if [ "$1" = at-restart ]; then
  echo "LG's Home from the next restart."
  exit 0
fi
[ -f "$D/debloat-undo.sh" ] && sh "$D/debloat-undo.sh" </dev/null >/dev/null 2>&1
if ! replaced; then
  say "undo-home: LG's Home isn't replaced; nothing to undo"
  exit 0
fi
if ! ours; then
  say "undo-home: the mount over LG's Home isn't HomeTV's; left alone"
  echo "undo-home: the mount over LG's Home isn't HomeTV's; left alone (a restart clears it)" >&2
  exit 1
fi
for t in 1 2 3; do
  replaced && ours || break
  umount "$H" 2>/dev/null || sleep 1
done
if replaced; then
  say "undo-home: the mount over LG's Home is still there (busy); it goes at the next restart"
  echo "undo-home: the mount over LG's Home is busy; LG's Home comes back at the next restart" >&2
  exit 1
fi
systemctl restart sam
for i in $(seq 1 60); do systemctl is-active sam >/dev/null 2>&1 && break; sleep 2; done
sh "$D/after-sam.sh" </dev/null
sleep 5
# the old web renderer would keep showing HomeTV; retry until LG's flutter Home is up
for t in 1 2 3 4; do
  pkill -f "[a]pp-id=com.webos.app.home"
  sleep 3
  luna_send -n 1 -w 10000 -f luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home"}' >/dev/null
  sleep 8
  pgrep -f "[f]lutter-client -i com.webos.app.home" >/dev/null && ! pgrep -f "[a]pp-id=com.webos.app.home" >/dev/null && break
done
say "undo-home: LG's Home is back${1:+ until the next restart}"
exit 0
