#!/bin/sh
# Shared by HomeTV's root scripts. Every path can be pointed elsewhere for the tests (tests/root.test.mjs); on the TV
# none of these variables is set. Adapted from lasharor/cleanyourtv-WebOS (MIT, see root/README.md).
export PATH=${HOMETV_PATH:-/usr/bin:/usr/sbin:/bin:/sbin:$PATH}
D=${HOMETV_DIR:-/media/developer/hometv}
H=${HOMETV_HOME_APP:-/usr/palm/applications/com.webos.app.home}
MOUNTS=${HOMETV_MOUNTS:-/proc/mounts}
MOUNTINFO=${HOMETV_MOUNTINFO:-/proc/self/mountinfo}
LOG=${HOMETV_LOG:-/tmp/hometv-boot.log}
ALIVE=${HOMETV_ALIVE:-/tmp/hometv-alive}
# This start's id (new at each start) and the file the start-up hook copies it to: from the two, HomeTV's service tells
# that the hook didn't run this start, as after an LG update that ended root (service/service.js, rootState)
BOOT_ID=${HOMETV_BOOT_ID:-/proc/sys/kernel/random/boot_id}
STARTED=$D/started
APP_ID=${HOMETV_APP_ID:-com.hometv.app}
APP=${HOMETV_APP:-/media/developer/apps/usr/palm/applications/$APP_ID}
# Homebrew Channel's start-up hooks (install.sh links HomeTV's two here; "Use LG's Home" removes them)
INITD=${HOMETV_INITD:-/var/lib/webosbrew/init.d}
# Homebrew Channel's tool that lets an installed app's service run as root, outside LG's jail (webosbrew, MIT)
ELEVATE=${HOMETV_ELEVATE:-/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/elevate-service}
# luna-service2's permission files, read only (decide.js acg): LG's own, and those for installed apps
LS2_ROOTS=${HOMETV_LS2_ROOTS:-/usr/share/luna-service2 /var/luna-service2 /var/luna-service2-dev}
# The heartbeat's way in over 127.0.0.1 (the tests point it at a stand-in that only notes it ran)
HEARTBEAT=${HOMETV_HEARTBEAT:-$D/heartbeat.js}
up() { cut -d' ' -f1 /proc/uptime 2>/dev/null || echo 0; }
say() { echo "$(up) $*" >> "$LOG"; }
luna_send() { command luna-send "$@" </dev/null; }
replaced() { grep -q " $H " "$MOUNTS"; }
# The mount over LG's Home is HomeTV's: its marker shows through it (stage-home.sh), or the kernel says the mount's source
# is HomeTV's home-overlay folder. Nothing else over LG's Home is ever unmounted (lasharor's "Native Home restoration
# safety", MIT, read at 2debe62).
ours() {
  [ -f "$H/.hometv-overlay" ] && return 0
  # the top mount over LG's Home (the last line for it), the one umount would take
  awk -v h="$H" '$5 == h { r = $4 } END { exit !(r ~ /\/hometv\/home-overlay$/) }' "$MOUNTINFO" 2>/dev/null
}
# The TV's model name or firmware (Settings' Software Version), from LG's system properties: info modelName|firmwareVersion
info() { luna_send -n 1 -w 5000 -f luna://com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["modelName","firmwareVersion"]}' 2>/dev/null | sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" | head -n 1; }
foreground() { luna_send -n 1 -w 5000 -f luna://com.webos.applicationManager/getForegroundAppInfo '{}' 2>/dev/null | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p' | head -n 1; }
