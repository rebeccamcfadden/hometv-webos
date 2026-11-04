#!/bin/sh
# Undoes debloat-stop.sh: starts the services again, removes the stubs and the hosts copy. Only mounts it made itself are
# touched (a hosts table mounted by something else, like Homebrew Channel's update block, is left alone).
# From lasharor's debloat-undo.sh (MIT).
. "$(dirname "$0")/lib.sh"
G=" ${*:-ads tracking logs suggestions} "
on() { case "$G" in *" $1 "*) return 0 ;; esac; return 1; }
SBIN=${HOMETV_SBIN:-/usr/sbin}
HOSTS=${HOMETV_HOSTS:-/etc/hosts}
units=""; bins=""
on logs && units="$units remotelogger service-logger"
on suggestions && { units="$units contentminer nudge"; bins="$bins sportsalarm"; }
on tracking && bins="$bins acr2"
on ads && bins="$bins adoverlay-service"
for b in $bins; do
  grep -q " $SBIN/$b " "$MOUNTS" && umount "$SBIN/$b" 2>/dev/null && say "debloat-undo: $b back"
done
for s in $units; do systemctl --no-block start "$s.service" >/dev/null 2>&1; done
on ads || exit 0
if [ -e "$D/hosts.mounted" ]; then
  umount "$HOSTS" 2>/dev/null
  rm -f "$D/hosts.mounted" "$D/hosts"
  say "debloat-undo: hosts back"
fi
exit 0
