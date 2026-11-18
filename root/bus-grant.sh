#!/bin/sh
# Lets LG's Home (HomeTV mounted over it) call HomeTV's service on the bus: one client-permissions file giving
# com.webos.app.home a group of HomeTV's own (hometv.home), one api-permissions file putting HomeTV's service's methods in
# it, and a manifest naming both, in luna-service2's folder for installed apps, then a rescan (as Homebrew Channel's
# elevate-service does). OFF unless hometv-lg root --home-again --watch saw the bus refuse LG's Home's call and the owner
# typed yes (call #2, 2026-11-18). Untested on a TV. The files stay across restarts; recorded in $D/bus-granted, and
# undo-home.sh (for good) and uninstall.sh remove them. Touches no file of LG's, only these three of HomeTV's.
#   bus-grant.sh grant | revoke | status
. "$(dirname "$0")/lib.sh"
LS2DEV=${HOMETV_LS2DEV:-/var/luna-service2-dev}
NAME=hometv-home-grant
CP=$LS2DEV/client-permissions.d/$NAME.json
AP=$LS2DEV/api-permissions.d/$NAME.api.json
MF=$LS2DEV/manifests.d/$NAME.json
REC=$D/bus-granted
rescan() { command -v ls-control >/dev/null 2>&1 && ls-control scan-services >/dev/null 2>&1; true; }
revoke() {
  [ -f "$REC" ] || return 0
  for f in $(cat "$REC"); do
    case "$f" in "$LS2DEV"/*/"$NAME"*.json) rm -f "$f" ;; esac
  done
  rm -f "$REC"
  rescan
  say "bus-grant: removed; LG's Home has no group of HomeTV's any more"
}
case "$1" in
  grant)
    for d in client-permissions.d api-permissions.d manifests.d; do
      [ -d "$LS2DEV/$d" ] || { echo "bus-grant: no $LS2DEV/$d on this TV; nothing written" >&2; exit 1; }
    done
    # recorded first, so the undo knows a grant even if writing it stops half-way
    echo "$CP $AP $MF" > "$REC" || exit 1
    if printf '{"com.webos.app.home*":["hometv.home"]}\n' > "$CP" &&
      printf '{"hometv.home":["%s.service/*"]}\n' "$APP_ID" > "$AP" &&
      printf '{"id":"%s","version":"1.0.0","serviceFiles":[],"roleFiles":[],"clientPermissionFiles":["%s"],"apiPermissionFiles":["%s"]}\n' "$NAME" "$CP" "$AP" > "$MF"; then
      rescan
      say "bus-grant: LG's Home may call HomeTV's service (group hometv.home)"
      echo granted
    else
      revoke
      echo "bus-grant: couldn't write the files; nothing left behind" >&2
      exit 1
    fi
    ;;
  revoke) revoke ;;
  status) [ -f "$REC" ] && echo granted || echo none ;;
  *) echo "usage: bus-grant.sh grant|revoke|status" >&2; exit 2 ;;
esac
exit 0
