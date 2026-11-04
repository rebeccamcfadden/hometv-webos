#!/bin/sh
# Restarts the services that keep talking to the old app manager after sam restarts (which ones: decide.js aftersam).
# Only those this TV has and runs. A file after-sam-services in the HomeTV folder replaces the list on one TV (an empty
# file: none). From lasharor's after-sam.sh (MIT).
. "$(dirname "$0")/lib.sh"
sdk=$(luna_send -n 1 -w 5000 -f luna://com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["sdkVersion"]}' 2>/dev/null | sed -n 's/.*"sdkVersion": *"\([^"]*\)".*/\1/p' | head -n 1)
home=$(node "$D/decide.js" kind "$D/backup/home-appinfo.orig.json")
list=$(node "$D/decide.js" aftersam "$sdk" "$home")
note=""
if [ -f "$D/after-sam-services" ]; then list=$(tr -c 'a-zA-Z0-9@._-' ' ' < "$D/after-sam-services"); note=" (from after-sam-services)"; fi
say "after-sam: SDK ${sdk:-unknown}, Home '${home:-unknown}', services: ${list:-none}$note"
for s in $list; do
  systemctl cat "$s.service" >/dev/null 2>&1 || { say "after-sam: $s not on this TV"; continue; }
  systemctl is-active "$s" >/dev/null 2>&1 || { say "after-sam: $s not running, left alone"; continue; }
  systemctl restart "$s" >/dev/null 2>&1
  say "after-sam: restarted $s"
done
exit 0
