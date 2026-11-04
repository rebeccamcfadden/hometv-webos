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
| `10-hometv-home` | Homebrew Channel start-up hook: mounts HomeTV over LG's Home, restarts the app manager (sam), starts the watchdog |
| `stage-home.sh` | Builds the folder mounted over LG's Home from HomeTV's installed page and the TV's own stock Home appinfo |
| `after-sam.sh` | Restarts the services that lose track of the app manager (webOS 25: videooutputd, umediaserver) |
| `undo-home.sh` | Puts LG's Home back: `temp` until the next start, or for good ("Use LG's Home") |
| `watchdog.sh` | Puts LG's Home back until the next start if HomeTV's page stops answering while on screen |
| `decide.js` | Which way, which services, and the appinfo for the mount |
| `lib.sh` | Paths, each overridable for the tests |

Not here yet: the debloat (stopping LG's ad and tracking services, in memory), install and uninstall, and tests.
