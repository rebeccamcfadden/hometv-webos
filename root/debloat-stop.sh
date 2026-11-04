#!/bin/sh
# Stops LG's ad and telemetry services while HomeTV is LG's Home, in memory only: a restart brings them all back unless
# the start-up hook runs again. Four groups (from lasharor's debloat-stop.sh, MIT), all or those named:
#   ads          adoverlay-service, and LG's ad servers blocked in a copy of /etc/hosts mounted in memory
#                (not admanager: HBO Max and Disney+ wait for it at start, lasharor's issue 47)
#   tracking     acr2 (Live Plus, the viewing tracking)
#   logs         remotelogger, service-logger
#   suggestions  contentminer, nudge, sportsalarm
# Unlike lasharor's, /etc/hosts itself is never written: a copy in memory only, so nothing outlives root.
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
for s in $units; do systemctl --no-block stop "$s.service" >/dev/null 2>&1 && say "debloat: stopped $s"; done
# services started on demand: a do-nothing stub mounted over the program, so it can't start again until the restart
printf '#!/bin/sh\nexit 0\n' > "$D/stub-noop"; chmod +x "$D/stub-noop"
for b in $bins; do
  [ -e "$SBIN/$b" ] || continue
  grep -q " $SBIN/$b " "$MOUNTS" || mount --bind "$D/stub-noop" "$SBIN/$b"
  pkill -9 -f "^$SBIN/$b"
  say "debloat: $b stubbed"
done
on ads || exit 0
if [ ! -e "$D/hosts.mounted" ] && ! grep -q "# hometv-debloat" "$HOSTS" 2>/dev/null; then
  cp "$HOSTS" "$D/hosts" && cat >> "$D/hosts" <<'EOF'
127.0.0.1 eic.ads.lgtvcommon.com us.ad.lgsmartad.com us.info.lgsmartad.com ad.lgappstv.com # hometv-debloat
::1 eic.ads.lgtvcommon.com us.ad.lgsmartad.com us.info.lgsmartad.com ad.lgappstv.com # hometv-debloat
EOF
  mount --bind "$D/hosts" "$HOSTS" && touch "$D/hosts.mounted" && say "debloat: ad servers blocked (hosts copy in memory)"
fi
exit 0
