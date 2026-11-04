#!/bin/sh
# One per boot, started by 10-hometv-home. While HomeTV is LG's Home, it checks every 10 seconds that HomeTV's page is
# alive (the page's service touches $ALIVE while the page shows). If Home is on screen and the page hasn't been alive for
# about a minute, LG's Home comes back until the next restart (undo-home.sh temp). Idea and shape from lasharor's
# watchdog.sh (MIT); the heartbeat from Hearth's /tmp/launcher-alive (MIT).
{
  . "$(dirname "$0")/lib.sh"
  EVERY=${HOMETV_WATCH_SECS:-10}
  LIMIT=${HOMETV_WATCH_LIMIT:-6}
  bad=0
  n=0
  while [ -f "$D/decide.js" ] && [ ! -e "$D/DISABLE" ]; do
    n=$((n + 1))
    [ -n "$HOMETV_WATCH_MAX" ] && [ $n -gt "$HOMETV_WATCH_MAX" ] && break   # tests only
    sleep "$EVERY"
    replaced || break
    [ "$(foreground)" = com.webos.app.home ] || { bad=0; continue; }
    age=$(( $(date +%s) - $(date -r "$ALIVE" +%s 2>/dev/null || echo 0) ))
    if [ "$age" -le $((EVERY * LIMIT)) ]; then bad=0; continue; fi
    bad=$((bad + 1))
    if [ $bad -ge "$LIMIT" ]; then
      say "watchdog: HomeTV's page hasn't answered for a minute while on screen; LG's Home until the next restart"
      sh "$D/undo-home.sh" temp
      break
    fi
  done
  exit 0
}
