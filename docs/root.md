# Rooting an LG TV for HomeTV, and the way back

> [!WARNING]
> **Work in progress, not tested on a real TV.** Only if you were asked to, and only if the TV's owner agrees. Rooting
> can go wrong, and there is no "unroot" button. HomeTV works without it, as an app ([install.md](install.md), Path 1).

The guide for the person at the TV, the same steps as the Pages page
[`/root/`](https://rebeccamcfadden.github.io/hometv-webos/root/) (`docs/root/index.html`), with links for helpers.
The plan behind it, with sources: [root-plan.md](root-plan.md). The install steps in detail:
[install.md](install.md#the-laptop-tools-install-steps).

Rooting lets HomeTV open when Home is pressed and when the TV switches on, in place of LG's own Home. It is done on
the phone with the person helping, after HomeTV was installed without root and worked. A program on the laptop does
the work and checks each step. About an hour, plus the time to get ready.

## What root is, and isn't

- **It is** using a mistake in LG's software to get full control of the TV. A free tool,
  [SlopBro](https://github.com/throwaway96/slopbro), does that from the laptop and puts the
  [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) app on the TV. HomeTV then goes on through
  Homebrew Channel.
- **It changes** only the TV's writable storage: Homebrew Channel, a few of its switches, and HomeTV's two start-up
  hooks. HomeTV takes the place of LG's Home only **in memory**, again at each start: a start without it gives LG's
  Home back ([root-plan.md](root-plan.md#what-root-changes)).
- **It isn't** new TV software. LG's signed firmware is never changed, and nothing is flashed.
- **It doesn't** send anything anywhere, or touch the apps, accounts or settings.

## The risk, in plain words

- **There is no unroot button.** The full undo is LG's own factory reset. It works, but clears all the TV's settings,
  apps and sign-ins. That's why the backup comes first.
- **A TV that won't start** is possible, but rare. The ways back below cover it, from a restart to LG's USB recovery.
  The only known ways to a TV that even those can't fix are writing to LG's signed partitions or locking files with
  `chattr`; SlopBro, Homebrew Channel and HomeTV do neither.
- **The TV stays off LG's updates.** An LG update usually ends root, so automatic updates stay off, which also means no
  security fixes from LG meanwhile. If an update comes anyway, LG's Home simply comes back
  ([After an LG update](#after-an-update)).
- **It may void the warranty.**
- **Only some TVs.** LG fixed the mistake in software released after about October 2026. The program checks the TV's
  software version and stops on any it doesn't know (33.31.61 and 33.31.75 today;
  [root-plan.md](root-plan.md#333175-the-test-tvs-software-since-2026-11-17)).

## Before the call: run "Get ready"

A day or two before the call, the person at the TV runs the rooting program on their own:
`hometv-lg-root.exe prepare <tv address>` in Command Prompt in Downloads, or double-click it and choose **1 Get ready
for the call** (`tools/prepare.mjs`, `tools/lib/prepare.mjs`). It never changes the TV and never roots. One step at a
time, each saying what it does and how it's undone, stopping at the first that isn't ready, and carrying on there when
run again (`prepare --list`, `--from <step>`; its state is `prepare-state.json` in the HomeTV folder):

1. **The tools** (`tools`): `hometv-lg.exe` beside it (release `hometv-lg-v3`, downloaded if missing, held to its
   SHA-256; another `hometv-lg.exe` there is replaced only if agreed), HomeTV 0.2.0's .ipk in the HomeTV folder (so
   `root-install` needs no internet), and the root kit (`get root-kit`: Python and SlopBro, checked; nothing run).
2. **Windows' OpenSSH client** (`openssh`): present, or offered (`Add-WindowsCapability -Online -Name
   OpenSSH.Client~~~~0.0.1.0`, one Windows prompt, said first); on "no" it says how to add it by hand.
3. **The firewall** (`firewall`; on the 2026-11-17 call the TV couldn't reach the laptop): shows the profile Windows
   gives the network that reaches the TV (its adapter's name, never the Wi-Fi name), then offers, in one Windows prompt:
   that network set to Private, and an inbound allow rule on Private networks only, named "HomeTV root (remove after
   the call)", for the root exe and the root kit's Python (SlopBro serves from Python). Both go in the undo list
   (`prepare-undo.json`) before the change. A work ("Domain") network stops it. Then the existing reach check: the
   TV's browser opens the laptop's address.
4. **The TV** (`tv`): it answers (LG's Allow prompt, if needed); with the Developer Mode app there, Developer Mode is
   on (its SSH port answers) and Key Server answers, for `keep-keys` on the call (checked, never switched; it offers to
   save Developer Mode's key now with the passphrase, so the call doesn't need Key Server); automatic updates off (read,
   else asked). No Developer Mode app: noted (the TMDB token is typed again after root), not a stop.
5. **The software version** (`software`): read, or typed by the person on 10.3.2 (it refuses the read), with the model.
   Not in `root/compat.json` for this model family, or not in `ROOTABLE`: the program says plainly that root is off for
   this call (stage 2 only), and the report says so; the USB stick is then skipped.
6. **The backup** (`backup`): the existing one if this model's is less than 7 days old, else taken now.
7. **The sign-in list** (`sign-in-list`): `sign-in-list.txt` in the HomeTV folder from the TV's app list (names only,
   LG's own apps left out), plus "LG account" and "Wi-Fi name: write it here"; no passwords, no address.
8. **The photos** (`photos`): the screens from [root-plan.md › Backup](root-plan.md#backup-step-3), part 2, listed;
   the person types `done`.
9. **The USB stick** (`usb-stick`): LG's US support page lists the firmware zips (for 43UT8000AUA:
   `Software_File(Version_33.31.75).zip`, about 1.6 GB) but publishes no checksum or signature to check them on the
   laptop, and serves them through download buttons; so the program doesn't download: it opens LG's page, walks
   through (download, unzip, FAT32 stick of 32 GB or less, `LG_DTV`, the `.epk`; it never formats or writes), then
   runs the `get recovery` stick check.

At the end, `prepare-report-<date>.txt` (masked: no address, serial, device id or Wi-Fi name) lists each item ready
or not ready, for the person to send; its last line is "Ready for the call", "Ready for the call: stage 2 only …", or
"Not ready yet. Missing: …". After the call, `hometv-lg-root.exe prepare --undo` (or the menu's **After the call**)
takes the rule out and puts the network's profile back, in one Windows prompt, and reads both back. The network is
put back only while the laptop is on that same network (the undo list keeps it as a salted hash of its name, never the
name), else it says to connect to it and keeps it on the list; after an undo, `prepare` checks the firewall again. The
released `hometv-lg.exe` refuses `prepare` like the other root commands.

## Have these ready

"Get ready" above does or checks each of these.

- **The rooting program.** The released `hometv-lg.exe` (on the [check page](https://rebeccamcfadden.github.io/hometv-webos/check/))
  leaves the root install out; the rooting program is its own release, `hometv-lg-root.exe` in
  [`hometv-lg-root-v1`](https://github.com/rebeccamcfadden/hometv-webos/releases/tag/hometv-lg-root-v1) (built with
  `npm run exe -- --root`), linked with its SHA-256 from the [root page](https://rebeccamcfadden.github.io/hometv-webos/root/).
- **The backup file** of this TV on the laptop: `lg-backup-….json` in `%USERPROFILE%\HomeTV`. The install made one;
  if not, `hometv-lg check <tv address> --backup` ([backup.md](backup.md)).
- **Photos of the TV's settings screens**: picture, sound, the privacy switches, the home-row order, Power On Screen
  and Quick Start+, HDMI device links (SIMPLINK), the channel list if an aerial is used, accessibility.
- **A sign-in list**, on paper: the apps to sign in to again, the LG account if there is one, the Wi-Fi name. No
  passwords on it.
- **A USB stick with LG's firmware for this TV** (FAT32, so 32 GB or smaller; it gets erased), for level 5:
  [recovery.md › The USB stick](recovery.md#the-usb-stick-level-5). It stays in the laptop for the checklist: the
  program reads it.
- **Automatic updates off:** *Settings › All Settings › Support › Software Update › Allow Automatic Updates* OFF (done
  during the install).
- **The remote, and an hour** with the TV free. The laptop on the same Wi-Fi as the TV.

## The steps

1. **Run the rooting program**, in Command Prompt, in Downloads: `hometv-lg-root.exe root <tv address>`. Before each step it
   says what the step does and how it's undone; it stops at the first thing that isn't right and says what to do. Run
   it again and it carries on where it stopped (`--list` shows the steps, `--from <step>` starts at one).
2. **The checklist** (`root-preflight`): the TV answers and the backup is on the laptop; then one question at a time:
   the photos, the sign-in list, the USB stick's drive letter (it reads the stick), automatic updates (asked only if
   the TV doesn't say). Last, if the TV's owner agrees, type `root`.
3. **Keep the saved keys** (`keep-keys`): deleting HomeTV deletes the keys its key page saved (the TMDB token, and
   price keys if any). While Developer Mode is still on, the program reads them over its SSH (with Key Server on, it
   may ask for the passphrase) and keeps them in the HomeTV folder (`lg-keys-kept.dpapi`), encrypted so only this
   Windows user can open them. It never shows a key, only its last 4 characters. If it can't read them it says so and
   carries on: type the TMDB token again on the key page from the phone after root.

   **Clear the way** (`clear-the-way`): delete HomeTV and the Developer Mode app on the TV, then restart it: **unplug at
   the wall, 30 seconds, plug in, turn on** (the remote's power button isn't a restart: Quick Start+). The Developer
   Mode app goes *before* root and never comes back after (SlopBro issue #22; Homebrew Channel #256). It then checks
   LG's Home and the backup's apps are there.
4. **The checks** (`root-checks`): the software version (when the TV won't say, the person reads it in *Settings › All
   Settings › Support › TV Information* and types it), the stick again, the root kit's checksum, the TV reaches the
   laptop (Windows may ask to allow the program on private networks: Allow).
5. **Root** (`root`): it says once more what happens; type `root the TV`. The TV's browser opens and works for a while,
   then the TV restarts. Press Enter when Home shows.
6. **Open Homebrew Channel once** (`hbc-check`) from the app list, wait for its list, press Enter. If it isn't there,
   the program stops: don't run it again, tell the person helping.
7. **HomeTV goes on** (`root-install`): HomeTV back, the start-up hooks, then the lock-down: SSH with this laptop's key
   only, Telnet off, Block system updates on.
8. **Restart and check** (`restart-check`): restart the same way. The picture may stay black for about ten seconds
   (normal). Press Home; it asks *Is it HomeTV on screen?*. If HomeTV didn't come up, it rolls back by itself (LG's Home
   back) and says so.
   **The keys back** (`keys-back`): the saved keys go into the root edition's HomeTV, HomeTV's service reads them,
   and the laptop's copy is deleted. If that fails, the copy stays and it says what to do (`--from keys-back` after a
   restart, or type the token from the phone).
9. **The report**: `lg-root-report-<date>.txt` in the HomeTV folder, with no address or serial number. Send it to the
   person helping.

## The ways back, lightest first

<a id="way-back"></a>Pick the lightest that does the job; each is safe to try before the next. The detail is in
[root-plan.md › The way back](root-plan.md#the-way-back-step-4-from-lightest-to-heaviest); levels 3-5 step by step in
[recovery.md](recovery.md); smaller troubles (a black screen after a restart, Home Style) in
[troubleshooting.md](troubleshooting.md).

| Level | When | What to do | Then |
|---|---|---|---|
| 0 | Something is odd, once | Press **Home three times** within two seconds while HomeTV is on screen, or unplug the TV for 30 seconds | LG's Home until the next start |
| 1 | LG's Home is preferred | In HomeTV, *Settings › Use LG's Home*, then restart. Back: `hometv-lg-root.exe root <tv address> --home-again` | LG's Home; HomeTV stays as an app; root stays, unused |
| 2 | HomeTV off Home for good | `hometv-lg-root.exe unroot-home <tv address>` (restart and checks), then delete HomeTV in Homebrew Channel if wanted | LG's Home; Homebrew Channel stays |
| 3 | No root at all: the full unroot | *Settings › All Settings › General › System › Reset to Initial Settings*, then set up again with the backup (`hometv-lg restore`), the photos and the sign-in list | The TV as it came, on its current firmware |
| 4 | The TV won't finish starting | Unplug for 30 seconds; if Settings opens, level 3. If not, pull the plug while LG's logo shows; at *Failsafe mode!* choose *Reboot later*, then straight to level 3 (the failsafe start leaves Telnet open without a password until the next restart) | A working TV |
| 5 | Still won't start | TV unplugged, the stick in, plug in and turn on; *Yes* to the update; don't switch off until it restarts by itself. Then level 3 | LG's firmware put back |
| 6 | Nothing works | LG service; tell them the TV was rooted | - |

## After an LG update

<a id="after-an-update"></a>HomeTV's "LG's Home is back" notice links to this section on the Pages site
(`/root/#after-an-update`, `AFTER_UPDATE_URL` in `app/src/webos/rootEdition.ts`).

If the TV updates its software (by hand, or after automatic updates came back on), root usually ends. That is
harmless:

- **LG's Home is back** from the next start. HomeTV, opened from its tile, may say so once (once per software version,
  with *Don't show again*).
- **HomeTV still works** as an app, from its tile.
- **Nothing is broken**: apps, inputs and settings are as they were.

The choices, none urgent: **leave it** (LG's Home, HomeTV as an app); **clean up** with a factory reset (level 3), then
HomeTV as a Developer Mode app ([install.md](install.md), Path 1); or **root again**, only if a tool exists for the new
software.

Two cases that look alike:

- **Homebrew Channel still opens, but Home is LG's:** root is still there; the new software isn't in
  `root/compat.json`, so HomeTV's start-up hook stepped back. `hometv-lg-root.exe root <tv address> --home-again` explains it
  and asks before putting HomeTV back ([troubleshooting.md](troubleshooting.md)).
- ***Use LG's Home* was chosen** (level 1): a choice, not an update; HomeTV says nothing then.

On the laptop, `hometv-lg.exe check <tv address>` says *Root: still on*, or what's wrong and what to do next
([root-plan.md › When an LG update ends root](root-plan.md#when-an-lg-update-ends-root)):

- *Can't reach the TV*: check it's on and on the same Wi-Fi, then run it again.
- *Root looks fine, but the laptop can't log in* (Homebrew Channel is still in the TV's apps): on the TV, open
  Homebrew Channel › Settings, check SSH Server is on, then run it again.
- *Root has ended* (Homebrew Channel is gone), with the choices above; or *Root has ended (an update may have removed
  it)* when HomeTV's start note says its start-up hook didn't run.
- *Can't tell*, when the TV's app list couldn't be read: it says which, and to look for Homebrew Channel in the apps.

## Good to know

- **HomeTV's own updates:** *Settings › Updates* in HomeTV. Nothing is downloaded before *Install update* is pressed;
  a new version that doesn't answer is swapped back by itself ([updates.md](updates.md#the-root-editions-own-updates)).
- **Keep the USB stick, the backup file, the photos and the sign-in list** for as long as the TV is rooted.
- **Never install the Developer Mode app again** on a rooted TV: it can wipe Homebrew Channel and HomeTV
  (`/media/developer`). `hometv-lg devmode` refuses a rooted TV for that reason.

## Thanks

HomeTV builds on other people's open-source work: [SlopBro](https://github.com/throwaway96/slopbro) (the root itself,
pinned to `f76b717`, its single file built and checked by `hometv-lg get root-kit`); [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel), from the webOS Homebrew
project (the start-up hooks, the failsafe start, the lock-down switches);
[lasharor's cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS) (taking Home over in memory, its checks
and its updater; MIT, notices in [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)). Home pressed three times is
an idea from [Razdva122's launcher](https://github.com/Razdva122/clean-your-tv-lg-webos) (no code taken).
