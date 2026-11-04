# HomeTV's root edition (research, untested)

> [!WARNING]
> **Research only. Not tested on any TV.** These scripts need a rooted TV (Homebrew Channel) and must not be run
> without the owner's agreement and the backup and way back in [../docs/root-plan.md](../docs/root-plan.md).

Adapted from [lasharor/cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS) (MIT; notice in
[../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)), the "mount" way only (LG's flutter or web Home, webOS 24 and
newer). Everything it does lives in memory and is re-applied at each start, so a start without the hook (an LG update
that ends root, or Homebrew Channel's failsafe start) leaves LG's Home as it was.

| File | What it does |
|---|---|
| `10-hometv-home` | Homebrew Channel start-up hook: elevates HomeTV's service (Homebrew Channel's `elevate-service`, so its heartbeat reaches the real `/tmp`), mounts HomeTV over LG's Home, restarts the app manager (sam), starts the watchdog |
| `stage-home.sh` | Builds the folder mounted over LG's Home from HomeTV's installed page and the TV's own stock Home appinfo |
| `after-sam.sh` | Restarts the services that lose track of the app manager (webOS 25: videooutputd, umediaserver) |
| `undo-home.sh` | Puts LG's Home back: `temp` until the next start, or for good ("Use LG's Home") |
| `watchdog.sh` | Puts LG's Home back until the next start if HomeTV's page stops answering while on screen |
| `decide.js` | Which way, which services, and the appinfo for the mount |
| `debloat-stop.sh`, `debloat-undo.sh`, `15-hometv-debloat` | Stops LG's ad and telemetry services while HomeTV is Home (four groups; the ad servers blocked in a copy of `/etc/hosts` mounted in memory, never in the file itself), and puts them back |
| `install.sh` | Run as root once (`hometv-lg install` copies this folder, all but this README, to `/media/developer/hometv` with Unix line ends and runs it there): refuses without Homebrew Channel's hooks, with the Developer Mode app, without HomeTV, or with a native Home; saves LG Home's own appinfo; adds the two hooks |
| `uninstall.sh` | LG's Home back now, the hooks and the HomeTV folder gone; restart afterwards |
| `lib.sh` | Paths, each overridable for the tests |

Tested on a PC only, with stub commands (`tests/root.test.mjs`). The heartbeat: HomeTV's page calls its service
(`service/service.js`) every 10 seconds while it shows, and the service touches `/tmp/hometv-alive`. Elevation only
changes HomeTV's own service registration (`/var/luna-service2-dev`); removing the HomeTV app removes it. The
settings backup and restore run from the laptop, not from here ([../docs/backup.md](../docs/backup.md)). HomeTV's own
updates on a rooted TV (Homebrew Channel's repository, and a new .ipk reaching Home after the next restart):
[../docs/updates.md](../docs/updates.md).
