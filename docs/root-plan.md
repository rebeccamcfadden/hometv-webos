# Rooting the test TV, with a way back: the plan

Written 2026-11-04. Nothing here has been run on any TV, and it gives no exploit steps. The brief: make sure the
ability to unroot is part of the backup process, so nothing is bricked if something goes wrong or the TV's owner
doesn't like it; test unrooted first, then prepare the backup and unrooting configuration, then the root/full
install. **The plan: one launcher of our own, installed unrooted first as a check, then rooted only after a backup
and an unroot path are ready.** **LG's automatic updates are turned off on the first test call**, to keep root
possible (LG's security fixes wait meanwhile; undo: switch them back on).

The test TV: 43UT8000AUA, webOS 25, release 10.3.1-3001 (software 33.31.61).

## The short version

- **Root changes only writable storage**, nothing in LG's signed firmware: the Homebrew Channel app, some flag files
  and start-up scripts, and service permissions. The home-screen takeover itself lives **in memory only** and is
  re-applied at each start. (Read from the tools' source.)
- **There is no clean "unroot" button.** Homebrew Channel can't uninstall itself, and a manual clean-up left a TV
  hanging in one report. **The accepted full unroot is LG's own Reset to Initial Settings** (a factory reset): it
  clears root, Homebrew Channel and everything installed through it, and keeps the current firmware. It also clears
  all the TV's settings, apps and sign-ins, which is why the backup comes first.
- **A lighter undo also exists if the TV's owner doesn't like it:** HomeTV switched off, so LG's Home is back after a
  restart, root left in place and unused. Or uninstall HomeTV. No factory reset needed.
- **Brick risk:** the only known ways to a TV that even a factory reset can't fix are writing to LG's signed partitions
  or locking files with `chattr`. Neither the root tool, Homebrew Channel nor our launcher does either; the plan
  forbids both. Homebrew Channel has a failsafe: a start that crashed is followed by a start without any of the
  customisations.
- **Two warnings for the test TV's exact firmware:** (1) an open report on a TV with the same exact software
  (33.31.61): root said "complete", the person then removed the Developer Mode app, and after the restart Homebrew
  Channel was gone. So the Developer Mode app (from the unrooted test) must be removed, and the TV restarted,
  **before** root, never after.
  (2) An LG update will most likely end root at some point (automatic updates are off, but one can still be installed
  by hand or come back on after a reset). The plan makes that harmless: LG's Home
  simply comes back.

## The steps

Each step says what changes on the TV, how it's undone, the risk, and what's proven where. The installer (one Windows
window) runs them in order and stops on any failed check.

| # | Step | What changes on the TV | Undo | Risk | Proven |
|---|---|---|---|---|---|
| 1 | **Laptop check** (LG's remote-control connection: model, firmware, apps, inputs, Netflix and YouTube open) | One "Allow" pairing for the laptop | Nothing needed (a factory reset clears it) | None | Built and tested against a pretend TV; the TV proves it |
| 2 | **HomeTV unrooted** (LG developer account, Developer Mode, HomeTV and its checks screen from the laptop) | Developer Mode on; HomeTV installed as a developer app | Delete HomeTV; delete the Developer Mode app | Very low | Packaging works; the TV proves it |
| 3 | **Backup** (below; [backup.md](backup.md)) | Nothing | - | None | Built and tested against pretend TVs; the TV proves it |
| 4 | **The way back, ready before root** (below): the undo for each level, LG's firmware file for the test TV's model on a USB stick, the steps printed | Nothing | - | None | On paper; the USB stick is checked on the PC |
| 5 | **Clear the way:** delete HomeTV and the Developer Mode app, restart, confirm Home and the apps work | Back to stock | - | Very low | The TV |
| 6 | **Root** with SlopBro (pinned to the reviewed commit `21023d5`) from the laptop; restart; confirm Homebrew Channel opens | See [What root changes](#what-root-changes) | Level 3 (factory reset) | Low but not zero; see the warning for the test TV's firmware | Footprint on paper; success only on the TV |
| 7 | **Lock it down:** SSH with a key only (no default password), Telnet off, "Block system updates" **on** as a second layer behind LG's own Allow Automatic Updates (switched off on the first call; undone in LG's menu), never `chattr` | Three flag files | Switch back in Homebrew Channel | None | On paper |
| 8 | **HomeTV through Homebrew Channel, on Home and at power-on** (the in-memory takeover, lasharor's method, credited) | HomeTV's files and one start-up script; the takeover in memory | Level 1 or 2 | Low; a watchdog puts LG's Home back if HomeTV stops answering | lasharor's reports on two sibling UT TVs on webOS 25; the TV proves it |

Steps 1-4 can be the first call; 5-8 the same call or a second one, depending on how long the unrooted install takes.

## What root changes

From the source of SlopBro (`wwwroot/autoroot.sh`, commit `21023d5`) and Homebrew Channel (`services/startup.sh`,
`jumpstart.sh`, `elevate-service.ts`):

| Change | Where | In memory or kept | Removed by a factory reset? | After an LG update |
|---|---|---|---|---|
| A "Developer Mode on" flag (a folder) | `/var/luna/preferences/devmode_enabled` | Kept | Yes (community reports) | May stop working |
| Homebrew Channel app and service | `/media/developer/apps/…` (writable app storage) | Kept | Yes | May stop working |
| Service permissions for Homebrew Channel | `/var/luna-service2-dev/…` | Kept | Yes (assumed) | May stop working |
| Start-up script and the folder for start-up hooks | `/var/lib/webosbrew/startup.sh`, `init.d/` | Kept | Yes | Usually stops running |
| Homebrew Channel's switches (failsafe, Telnet off, SSH on, block updates) | `/var/luna/preferences/webosbrew_*` | Kept | Yes | - |
| LG's Developer Mode restart counter cleared at each start | `/var/luna/preferences/dc*` | Each start | - | - |
| Root password, Telnet, SSH, telemetry blocked | Applied in memory at each start | Memory | - | Gone when start-up stops |
| The laptop's pairing | LG's system database | Kept | Probably | Unchanged |
| **HomeTV on Home** | A mount over LG's Home app | **Memory** | - | **Gone at the next start: LG's Home is back** |
| LG's signed firmware, kernel, boot loader | - | **Never touched** | - | - |

## Backup (step 3)

LG TVs have no settings export, so the backup is three parts, kept on the laptop and with the TV's owner:

1. **What the laptop can read** (the laptop check with `--backup`): picture mode and levels, sound output, the inputs,
   the TV's apps, the model and firmware. Saved without the TV's address, serial number or device id. With root, also
   whole settings categories, read only; `hometv-lg restore` puts them back ([backup.md](backup.md)).
2. **Photos**, guided screen by screen: picture and sound settings, the privacy switches ([privacy.md](privacy.md)),
   the home-row order, Power On Screen and Quick Start+, HDMI device links (SIMPLINK), the channel list if an aerial
   is used, accessibility settings.
3. **What would need signing in to again** after a factory reset: a list of the TV's apps and their accounts (no
   passwords written down by us), the Wi-Fi name (typed in again), the LG account, if there is one.

## The way back (step 4), from lightest to heaviest

| Level | When | What to do | End state | Needs |
|---|---|---|---|---|
| 0 | One-off trouble | Press Home three times in two seconds (HomeTV's way out, to build, as Razdva122's), or unplug for 30 seconds | LG's Home until the next start | Nothing |
| 1 | **LG's Home is preferred instead** | HomeTV's setting "Use LG's Home" (to build: removes its start-up hook), restart | LG's Home; HomeTV still installed as an app; root stays, unused | The remote |
| 2 | Remove HomeTV | Uninstall HomeTV in Homebrew Channel, restart | LG's Home; Homebrew Channel stays | The remote |
| 3 | **Full unroot** | Settings › General › System › Reset to Initial Settings; then the setup wizard and the backup | Stock TV on its current firmware: no root, no Homebrew Channel, no HomeTV | The remote; an hour to set up again |
| 4 | The TV won't finish starting | Wait for Homebrew Channel's failsafe start (the next start skips every customisation and opens a repair shell for the laptop), unplug 30 s; then level 3 | A working TV | The laptop on the same Wi-Fi |
| 5 | Still won't start | LG's USB recovery: the test TV's model's firmware file in a folder named `LG_DTV` on a FAT32 stick, TV off, stick in, TV on | Firmware reinstalled (same or newer version only) | The stick, prepared in step 4 |
| 6 | Nothing works | LG service | - | - |

What only the TV can prove: that a factory reset really clears every item above on the test TV's model (LG publishes
no detail; community reports say yes), that failsafe works on the test TV's firmware, and that LG's USB recovery
accepts the same version it runs. A rehearsal on another LG would prove 3-5 before the test TV; none is known to be
available.

## When an LG update ends root

Automatic updates are off from the first test call, but an update can still come (installed by hand, or with updates
switched back on). What to expect, from Homebrew Channel's issue #234 and the tools' notes: the update may close
SlopBro's bug, and may stop the start-up scripts. Then:

- **At the next start, LG's Home is back** (HomeTV's takeover is in memory only and isn't re-applied).
- Homebrew Channel and HomeTV may stay installed but not open: harmless.
- HomeTV avoids anything that would outlive root: no power-on file in `/var/luna/preferences/bootd.json` (Hearth's
  way, which its own docs say to switch off before an update), no "TV input" registration (an open report of a TV
  stuck at start-up after that, on Hearth), no ad-blocking written into `/etc/hosts` (lasharor's debloat, a v2 item,
  would keep it in memory only).
- Choices then: leave it (stock LG); a factory reset to clean up, then HomeTV as a Developer Mode app; or
  root again if a tool exists for the new firmware.

## Decided

- **The full unroot is a factory reset** (no clean unroot tool exists; a manual clean-up hung one TV reported).
  Accepted as level 3, done only with the backup in place.
- **The test TV's exact firmware has an open report** of Homebrew Channel missing after root, when the Developer
  Mode app was removed afterwards. The order above stands (Developer Mode app removed and a restart before root);
  the installer checks Homebrew Channel after the restart and stops if it's missing (then falls back to level 3).
- **Root on the first call, or a second:** depends on how long the unrooted install takes; the backup and USB stick
  are ready either way, and LG may update the TV in between (accepted).
- **LG's firmware file for the test TV's model goes on a USB stick** before root (level 5); LG's US support page
  offers it.

## Sources

- SlopBro: [repo](https://github.com/throwaway96/slopbro) (`wwwroot/autoroot.sh`, `wwwroot/main.js`, commit `21023d5`,
  2026-09-28); issues [#14](https://github.com/throwaway96/slopbro/issues/14) (clean unroot: factory reset),
  [#22](https://github.com/throwaway96/slopbro/issues/22) (33.31.61, Homebrew Channel missing; open, no replies).
- Homebrew Channel: [repo](https://github.com/webosbrew/webos-homebrew-channel) (`services/startup.sh`, `jumpstart.sh`,
  `elevate-service.ts`, `frontend/views/SettingsPanel.js`); issues [#11](https://github.com/webosbrew/webos-homebrew-channel/issues/11)
  (paths to clean), [#234](https://github.com/webosbrew/webos-homebrew-channel/issues/234) (after updates; factory reset).
- [rootmy.tv/warning](https://rootmy.tv/warning) (signed partitions, `chattr`); RootMyTV docs/TROUBLESHOOTING.md;
  webosbrew/pages (overlays, glossary, cheatsheet). RootMyTV itself doesn't apply to the test TV (patched since 2022,
  never on webOS 22+; [jailbreak.md](jailbreak.md)); SlopBro ends in the same Homebrew Channel set-up, so the undo is
  the same.
- Launchers' footprints: lasharor `docs/tv-changes.md`, `uninstall.sh`, `scripts/watchdog.sh`, issues #10, #11, #122;
  Hearth `src/poweron/README.md`, `src/homehook/`, issue #43. Detail: [launchers.md](launchers.md).
- LG: [Reset to Initial Settings](https://www.lg.com/us/support/help-library/lg-tv-how-to-reset-your-tv--20154634935200).
  USB recovery steps are from community guides (not an LG page): medium confidence.
