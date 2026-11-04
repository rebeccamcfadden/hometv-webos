#!/bin/sh
# Shared by HomeTV's root scripts. Every path can be pointed elsewhere for the tests (tests/root.test.mjs); on the TV
# none of these variables is set. Adapted from lasharor/cleanyourtv-WebOS (MIT, see root/README.md).
export PATH=${HOMETV_PATH:-/usr/bin:/usr/sbin:/bin:/sbin:$PATH}
D=${HOMETV_DIR:-/media/developer/hometv}
H=${HOMETV_HOME_APP:-/usr/palm/applications/com.webos.app.home}
MOUNTS=${HOMETV_MOUNTS:-/proc/mounts}
LOG=${HOMETV_LOG:-/tmp/hometv-boot.log}
ALIVE=${HOMETV_ALIVE:-/tmp/hometv-alive}
APP_ID=${HOMETV_APP_ID:-com.hometv.app}
APP=${HOMETV_APP:-/media/developer/apps/usr/palm/applications/$APP_ID}
# Homebrew Channel's tool that lets an installed app's service run as root, outside LG's jail (webosbrew, MIT)
ELEVATE=${HOMETV_ELEVATE:-/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service}
up() { cut -d' ' -f1 /proc/uptime 2>/dev/null || echo 0; }
say() { echo "$(up) $*" >> "$LOG"; }
luna_send() { command luna-send "$@" </dev/null; }
replaced() { grep -q " $H " "$MOUNTS"; }
foreground() { luna_send -n 1 -w 5000 -f luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p' | head -n 1; }
