# The heavy ways back: factory reset, failsafe start, LG's USB recovery

Levels 3, 4 and 5 of [root-plan.md](root-plan.md) › The way back, as steps to follow on the day. Levels 0-2 (Home
three times, Settings › Use LG's Home, `hometv-lg unroot-home`) are lighter and come first; level 6 is LG service.
The guide on the project's Pages site (B5) is written from this page.

**Research only, like the rest of the root edition:** nothing here has been done on the test TV. The factory reset is
LG's own; the failsafe start is Homebrew Channel's (read in its `services/startup.sh`); the USB recovery steps are
from LG's manual-update page and community guides (medium confidence). What only the TV can prove is listed at the end.

## Have these ready, before root and before any of these levels

| What | Where it comes from | What it's for |
|---|---|---|
| The backup file `lg-backup-<date>.json` | `hometv-lg check <tv address> --backup` (the first step of `hometv-lg install` and the check of `hometv-lg root`), in `%USERPROFILE%\HomeTV` | `hometv-lg restore` puts back what it holds ([backup.md](backup.md)) |
| The photos of the settings screens | Taken by hand, screen by screen ([root-plan.md](root-plan.md) › Backup, part 2) | Setting by hand what the backup can't |
| The sign-in list | Written by hand: the apps to sign in to again, the LG account if there is one, the Wi-Fi name (no passwords) | After a factory reset |
| The Wi-Fi password, and each app's password | The owner (never written into any HomeTV file) | After a factory reset |
| The USB stick, checked | [The USB stick](#the-usb-stick-level-5) below | Level 5 |
| The remote, and an hour | | |

## Level 3: factory reset (the full unroot)

When: LG's Home is wanted back with nothing of root left, or a lighter level didn't help, or the TV misbehaves after
root or after an LG update. It is the accepted full unroot: there is no unroot button.

1. On the TV: **Settings › All Settings › General › System › Reset to Initial Settings**. If it asks for a PIN and none
   was ever set, LG's default is `0000`.
2. Confirm. The TV restarts and opens LG's setup, as on the first day.
3. Set it up: language, country (the same as before: the apps on offer depend on it), Wi-Fi (the password), LG's
   agreements as the owner chooses ([privacy.md](privacy.md) says what each switch does).
4. Put the settings back:
   - `hometv-lg check <tv address>` first: the TV asks again to **Allow** the laptop (a reset forgets it).
   - `hometv-lg restore <backup file> <tv address> --dry-run` shows what would be written; then the same without
     `--dry-run`. It writes only what the backup holds and the TV accepts, and stops at the first error.
   - The rest by hand from the photos: picture and sound, the privacy switches, the home-row order, Power On Screen
     and Quick Start+, SIMPLINK, the channel list (a channel search, if an aerial is used), accessibility.
5. Sign in again from the sign-in list: the streaming apps, the LG account.
6. HomeTV without root, if wanted: `hometv-lg devmode <tv address>` ([install.md](install.md)).

What a reset takes away (from [root-plan.md](root-plan.md) › What root changes): root, Homebrew Channel and its
switches, the SSH key, HomeTV and its two start-up hooks, the apps installed since the first day, the settings, the
sign-ins. LG's firmware stays at the version it is on (a reset never goes back to an older one).

## Level 4: the TV won't finish starting

When: the TV stops at LG's logo, restarts again and again, or shows a black screen where Home should be, and pressing
Home doesn't help.

1. **Unplug the TV at the wall for 30 seconds**, plug it in, turn it on. Many one-off troubles end here (level 0).
2. **If the remote still works** (Settings opens, even over a black Home): do the level 3 factory reset now. It is
   the surest way out and doesn't need the failsafe start below.
3. **Homebrew Channel's failsafe start.** At each start, Homebrew Channel notes that a start is under way and clears
   the note about ten seconds after its start-up scripts (HomeTV's hooks among them) have run. If the TV restarts or
   is unplugged **before then**, the next start is a failsafe start: none of the start-up scripts run, so nothing of
   HomeTV runs, and LG's Home comes up. So the power has to be cut **early in the start**: turn the TV on, and pull
   the plug while LG's logo still shows (within about 15 seconds), before Home appears; wait 30 seconds; turn it on
   again. A TV that restarts again and again by itself does this on its own. Once Home has been up for a while, the
   note is cleared and unplugging gives a normal start.
4. A failsafe start says so: a message **"Failsafe mode! A crash has occured during startup"**, then a box offering
   **Reboot now** or **Reboot later**. Choose **Reboot later**: a normal restart runs the start-up scripts again and
   the trouble may come back.
5. **Don't leave the TV in this state.** During a failsafe start Homebrew Channel opens a root shell (Telnet) without
   a password, to anyone on the same Wi-Fi, until the next restart. Go straight on to step 6.
6. With LG's Home working, do the level 3 factory reset above (Settings › All Settings › General › System › Reset
   to Initial Settings). It removes the start-up scripts for good. Tell the HomeTV team what happened (the start-up
   notes are lost with the reset; a photo of the screen helps).
7. No failsafe message: the plug was most likely pulled too late; try step 3 again, earlier. Only if a few early tries
   give no "Failsafe mode!" and the TV never reaches a Home where Settings opens: level 5, then level 3 (the USB update
   may leave root's files in place).

## Level 5: LG's USB recovery

When: the TV won't start even after level 4. LG's USB update puts the firmware back from a stick; it takes only the
**same version or a newer one** than the TV runs.

### The USB stick (level 5)

Prepared **before root** (root-plan.md, step 4) and kept with the TV.

1. **The TV's exact model:** on the TV, Settings › All Settings › Support › TV Information (or the label on the
   back), for example `43UT73006LA`; and the **software version** on the same screen, for example `33.31.61`. The
   backup file holds both too.
2. **LG's firmware file:** on LG's support site for the country the TV was bought in (for example lg.com › Support ›
   Software & Drivers), enter the exact model, open **Software** (or **Firmware**), and download the newest file. It
   must be for this model and at least the version the TV runs. HomeTV doesn't download it for you: LG's links change
   and LG gives no checksum to check the file against.
3. **A stick formatted FAT32** (this erases it): File Explorer › right-click the stick › Format › File system
   **FAT32** › Start. Windows offers FAT32 only for sticks up to 32 GB: use one of those.
4. **Unzip LG's download on the laptop** and copy its **`LG_DTV` folder** to the top of the stick, so the stick holds
   `LG_DTV\<one file ending .epk>` and nothing else in that folder.
5. **Check it:** `hometv-lg get recovery E` (the stick's drive letter; the model and version come from the newest
   backup, or `--model` and `--software`). It reads the stick only: the format, `LG_DTV` at the top, exactly one
   `.epk`, its size, the model family and version when the file's name says them. Lines starting `?` are for you to
   check by hand. `hometv-lg root` runs the same check in its checklist.
6. **Eject it** (File Explorer › Eject), label it with the TV's model and the version, keep it with the TV.

Don't leave it in the TV: a TV that starts normally offers to install the file; choose **No** then, it isn't needed.

### Using it

1. Turn the TV off and unplug it at the wall.
2. Put the stick in the TV's USB port (any; the one marked for a hard disk if there is a choice).
3. Plug the TV in and turn it on. If the TV gets far enough to see the stick, it asks whether to update: choose **Yes**.
4. **Don't turn it off or unplug it during the update.** It restarts by itself when done; take the stick out then.
5. Then level 3, the factory reset: the USB update puts LG's firmware back, but root's files on the writable storage
   may stay.

If nothing happens, or the TV refuses the file: level 6, LG service. Tell them the TV was rooted.

## What only the TV can prove

For a first real-TV run (or a rehearsal on another LG, if one turns up); nothing above has been seen on a TV:

- After **Reset to Initial Settings**: Homebrew Channel is gone, `ssh` to port 22 and Telnet on 23 are closed, LG's
  Home is Home, and the app list matches a fresh TV (the root-plan.md table, item by item).
- **The failsafe start** on this firmware: how early in the start the plug has to be pulled (the 15 seconds above is
  a guess from `startup.sh`), that it brings up "Failsafe mode!", no HomeTV hook runs
  (`/tmp/hometv-boot.log` absent), and LG's Home works; the next normal restart runs the hooks again.
- **LG's USB recovery** on this model: a running TV offers the stick's file; the version it runs is accepted (LG's
  rule is "same or newer"); whether it acts at power-on on a TV that doesn't finish starting.
- **The stick's file name** for this model: whether LG's `.epk` name carries the model (then `hometv-lg get recovery`
  checks it) or not (then it asks).
