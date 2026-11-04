#!/bin/sh
# Builds the folder mounted over LG's Home: HomeTV's installed page plus an appinfo.json made from this TV's own stock
# Home (saved by install.sh; nothing of LG's is shipped). Safe to run again while mounted. From lasharor's stage-home.sh (MIT).
. "$(dirname "$0")/lib.sh"
S=$D/home-overlay
[ -f "$D/backup/home-appinfo.orig.json" ] || { say "stage: no backup of LG's Home appinfo"; exit 1; }
[ -f "$APP/index.html" ] || { say "stage: HomeTV isn't installed at $APP"; exit 1; }
mkdir -p "$S"
cp -R "$APP/." "$S/"
node "$D/decide.js" stage "$D/backup/home-appinfo.orig.json" "$S/appinfo.json"
