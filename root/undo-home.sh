#!/bin/sh
# Puts LG's Home back. "temp": until the next restart only. No argument: also writes DISABLE, so restarts keep LG's Home
# ("Use LG's Home"). Lifts the debloat first: LG's Home doesn't start without the ad services it stops. Never touches a
# mount that isn't over LG's Home. From lasharor's undo-home.sh (MIT), the mount way only.
. "$(dirname "$0")/lib.sh"
[ "$1" = temp ] || touch "$D/DISABLE"
[ -f "$D/debloat-undo.sh" ] && sh "$D/debloat-undo.sh" </dev/null >/dev/null 2>&1
LASTAPP=${HOMETV_LASTAPP:-/var/luna/preferences/bootd_last_foreground_app_id.json}
grep -q "$APP_ID" "$LASTAPP" 2>/dev/null && echo '{"lastAppId":"com.webos.app.home"}' > "$LASTAPP"
if ! replaced; then
  say "undo-home: LG's Home isn't replaced; nothing to undo"
  exit 0
fi
for m in $(awk -v h="$H" '$2 == h {print $2}' "$MOUNTS"); do umount "$m" 2>/dev/null; done
if replaced; then
  say "undo-home: the mount over LG's Home is busy; it goes at the next restart"
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
