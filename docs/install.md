# Getting HomeTV onto an LG TV

> [!WARNING]
> **Work in progress, not tested on a real TV.** Nothing here has been run on any TV yet. Only follow it if you're
> helping test HomeTV, and only on a TV whose owner agrees.

HomeTV v0 (the Home screen, the app row, All apps) reaches an LG TV as an app, an `.ipk` file. LG TVs have no store
for it, so there are two ways to put it there. **Path 1 is the one to use.**

| | Path 1: Developer Mode | Path 2: rooted |
|---|---|---|
| What it is | LG's own switch for app makers | Using a software bug to get full control of the TV |
| Needs | A free LG Developer account, a laptop on the same Wi-Fi, the `.ipk` | A TV on firmware LG hasn't fixed, a backup, a way back |
| Risk | Very low | Real: see the warning below |
| Keeps working | Until Developer Mode runs out (about every 1,000 hours) | Until an LG update ends root |
| Undo | Delete the app, or delete the Developer Mode app | A factory reset (clears everything on the TV) |
| Status | The way to test now | Research only |

## Path 1: Developer Mode

Developer Mode is a feature LG built for people who make TV apps. It lets a computer on your Wi-Fi install an app. It
doesn't change LG's software.

1. **Switch Developer Mode on.** On the TV, install LG's **Developer Mode** app from the TV's app store (**Apps**, or **LG Content Store** on older TVs), open it,
   sign in with an LG Developer account, press **Dev Mode Status** (the TV restarts), then open the app again and
   press **Key Server**. The app now shows a 6-letter **passphrase**.
2. **Run the laptop tool:** `hometv-lg devmode <tv address>` (or double-click `hometv-lg.exe` and choose 2). It
   downloads HomeTV v0 and v1 and checks each against its pinned SHA-256, gets the Developer Mode key from the TV
   (you type the passphrase), and then:
   - **First, automatic updates off.** It asks you to switch off *Settings › Support › Software Update › Allow
     Automatic Updates*, so the TV doesn't update itself during the checks. It reads the setting if the TV says,
     otherwise it asks two yes/no questions (was it on, is it off now). It never changes the setting itself.
   - **v0:** installs it the way LG's own `ares-install` does (SSH to the Developer Mode account `prisoner` on port
     9922, the `.ipk` copied to `/media/developer/temp` and installed with `luna-send-pub`, the copy deleted after),
     opens it and checks: the TV lists it, it comes to the front, the app list is read or denied, it is still open
     after 30 s, and an app launch (YouTube by contentId).
   - **v1 over v0:** the same checks, plus the settings kept through the update and the key page reachable.
   - It drives the app through the TV's Web Inspector (an SSH tunnel to the TV's port 9998). Where the script can't
     see something it asks a plain yes/no question ("Is HomeTV on the TV screen now?"). If the inspector isn't
     reachable, more of the checks become questions.
   - It writes `lg-devmode-<date>.txt` and `.json` in the HomeTV folder, with no IP address, serial number or device
     id. Code: [tools/lib/devmode.mjs](../tools/lib/devmode.mjs); tests against a pretend TV:
     [tests/devmode.test.mjs](../tests/devmode.test.mjs). `--only v0` or `--only v1` installs one; `--v0 <file>` and
     `--v1 <file>` use files you have (held to the same SHA-256).
   (Step-by-step, for someone who isn't technical: [docs/install/index.html](install/index.html).)
3. **If the tool can't install (fallback): Dev Manager.** `hometv-lg get dev-manager` downloads webosbrew's free
   [Dev Manager](https://github.com/webosbrew/dev-manager-desktop), checked against a pinned SHA-256, and starts its
   installer. *Add new device...* with the TV's IP address (for example `192.168.1.50`) and the passphrase, then on
   the Apps page click *Install* and pick the `.ipk`. To make one from this repository: `npm run package:app` (it
   refuses a build that still has the sample catalogue).
4. **Open HomeTV** from the TV's app list (the tool opens it for you).
5. **Afterwards:** switch Key Server off in the Developer Mode app.

**The catch: Developer Mode runs out.** A session lasts about 1,000 hours (about 41 days). Before then, open the
Developer Mode app and press **Extend**. If it runs out, LG removes the apps installed this way and HomeTV has to be
installed again. Developer Mode also switches off after 10 restarts without a network. HomeTV can't press Extend for
you yet.

**Undo:** delete HomeTV from the TV's app list, or delete the Developer Mode app (its apps go with it). To let the TV
update itself again: *Settings › Support › Software Update › Allow Automatic Updates* on (if it was on before; the
report says).

What this path can't do: replace LG's Home, or start HomeTV when the TV switches on. HomeTV is an app you open.
More in [jailbreak.md](jailbreak.md) and [launcher-replacement.md](launcher-replacement.md).

## Path 2: rooted (research only)

> [!CAUTION]
> **Research only. Do not do this unless the TV's owner agrees, and never without a backup and a way back.**
> Rooting uses a bug in LG's software. It can leave a TV that won't start, an LG update usually ends root (so a rooted TV is often kept
> off updates, which also means no security fixes), it may void the warranty, and **there is no "unroot" button**: the full undo is LG's
> *Reset to Initial Settings*, which clears all settings, apps and sign-ins. A TV can't go back to older firmware.
> Rooted TVs must not have the Developer Mode app installed, so the two paths don't mix.

With root, HomeTV's own scripts (in [`root/`](../root/README.md)) can show HomeTV in place of LG's Home, in memory
only, so a start without them gives LG's Home back. None of it has been run on a TV.

Read [root-plan.md](root-plan.md) first: what root changes, the backup, the undo levels, and the order (an unrooted
test first, then the backup, then root).

## The laptop tool's install steps

`hometv-lg install <tv address>` (or double-click `hometv-lg.exe` and choose 3; built with `npm run exe -- --root` only,
the released exe leaves it out until root is reviewed) takes the test TV from "Developer Mode
on" to "HomeTV is Home (root edition)", in the order decided in [root-plan.md](root-plan.md). Code:
[tools/lib/install-steps.mjs](../tools/lib/install-steps.mjs); tests against pretend TVs:
[tests/install.test.mjs](../tests/install.test.mjs).

| # | Step (`--from` name) | What the tool does | Stops if | Changes on the TV |
|---|---|---|---|---|
| 1 | `backup` | The settings backup of [backup.md](backup.md) (`tools/lib/backup.mjs`, as `hometv-lg check --backup`): what LG's remote-control connection lets it read, into `lg-backup-….json` | The TV can't be reached or paired | Nothing |
| 2 | `dev-install` | Shows the webOS Dev Manager steps for HomeTV's `.ipk`, then checks the TV lists `com.hometv.app` and that it opens. Skipped if Homebrew Channel is already there | HomeTV isn't listed, or doesn't open | HomeTV as a Developer Mode app (the person installs it) |
| 3 | `go-on` | Asks whether to root now. "No" stops here; the next run asks again | - | Nothing |
| 4 | `root-checks` | Software is 33.31.61 (only `major_ver` and `minor_ver` are read); the Developer Mode app isn't listed, and the person confirms a restart since; Python and SlopBro are in the HomeTV folder with SlopBro's pinned SHA-256; the person confirms the USB stick (LG's firmware in `LG_DTV`) and Allow Automatic Updates off; the TV reaches the laptop | Any of these | Nothing (the TV's browser opens for a moment) |
| 5 | `root` | Says what SlopBro does and that the full undo is a factory reset, then runs it only after the person types `root the TV`. Checks SlopBro's SHA-256 again first. Skipped if Homebrew Channel is already there | Anything else is typed (nothing runs); SlopBro ends with an error | Root and Homebrew Channel ([root-plan.md](root-plan.md), "What root changes") |
| 6 | `hbc-check` | After root's restart, `org.webosbrew.hbchannel` must be in the app list | It isn't (Q-R2): don't run SlopBro again, tell the team; level 3 if the TV misbehaves | Nothing |
| 7 | `root-install` | Over Homebrew Channel's Telnet (below): copies `root/` to `/media/developer/hometv`, puts HomeTV back if it's gone, runs `install.sh`, adds the laptop's SSH key, switches Telnet off and SSH on (from the next start) | Telnet closed; the shell isn't root; `base64`, `sha256sum`, `node` or `luna-send` missing; no start-up hooks folder; Homebrew Channel not running as root; a file arrives damaged; HomeTV can't be installed; `install.sh` refuses; Homebrew Channel doesn't take the switches | The root edition's files and two start-up hooks; HomeTV; one line in `/home/root/.ssh/authorized_keys`; two of Homebrew Channel's switches |
| 8 | `restart-check` | Asks for a restart, then checks Home is on screen, asks the person whether it's HomeTV, checks Telnet (23) is closed and SSH (22) logs in as root with the laptop's key (`tools/lib/root-shell.mjs`; the TV's host key is trusted this first time) | Any of these | Nothing |

How it behaves:

- **One step at a time.** Before each, it prints what the step does and how it's undone. The first failed check stops
  the run with what to do next; nothing after it runs.
- **Run again to carry on.** Finished steps are kept in `install-state.json` (HomeTV folder) and skipped.
  `--from <step>` runs again from a step on; `--list` shows each step's state. A "no" or a stop leaves the step to run
  again next time.
- **Questions only the person can answer** (a restart, the USB stick, LG's update switch, what's on screen) are
  `[y/N]`: anything but "y" stops.
- **What it keeps, in `%USERPROFILE%\HomeTV`:** `lg-backup-….json` (may hold identifiers: it stays on the laptop,
  [backup.md](backup.md)), `lg-client-key` (the pairing, shared with `hometv-lg check`), `install-state.json`,
  `install-log.txt` (everything it printed), `lg-root-key` with its `.pub`, and `lg-known-hosts`: the key and known
  hosts `hometv-lg check` and `hometv-lg restore` use with root. Nothing it prints, logs or keeps in its state holds
  the TV's address, serial number, device id, MAC or the Windows user name. SlopBro's own messages (step 5) do show the TV's address: they're on screen only.
- `--ipk <file>` names HomeTV's `.ipk`; otherwise it takes the newest `com.hometv.app_*.ipk` in the current folder,
  next to the exe, in the HomeTV folder or in `dist/` (`npm run package:app`).

Why it works this way:

- **Developer Mode install: guided Dev Manager.** Installing in Developer Mode means SSH to the TV's port 9922 with the
  key from its Key Server. Node has no SSH client and the exe is Node built-ins only; writing one (key exchange,
  ciphers) is large and easy to get wrong. So the person installs with Dev Manager (`hometv-lg get dev-manager`) and
  the tool checks the result over LG's remote-control connection.
- **HomeTV is put back after root.** Deleting the Developer Mode app (step 4 needs it gone) also removes the apps it
  installed. Step 7 copies the `.ipk` to `/tmp` and installs it with LG's installer as root, the way Homebrew
  Channel's `tools/install.sh` and SlopBro's `autoroot.sh` do (`luna://com.webos.appInstallService/dev/install`).
- **Telnet.** Homebrew Channel starts `telnetd -l /bin/sh` on port 23 at each start unless switched off: a root
  shell, no password. The tool (`tools/lib/telnet.mjs`, Node's `net`) answers Telnet's option questions, runs one
  command at a time followed by an end marker with its exit status, and copies files as base64 lines (under 1,024
  characters each) that the TV decodes and checks against the laptop's SHA-256. `root/`'s files go with Unix line ends.
- **Telnet off, SSH on, through Homebrew Channel's own service:** `luna-send … luna://org.webosbrew.hbchannel.service/setConfiguration
  '{"telnetDisabled":true,"sshdEnabled":true}'` (only those two switches), then `getConfiguration` to check. The
  switches are files in `/var/luna/preferences/` (`webosbrew_telnet_disabled`, `webosbrew_sshd_enabled`), read by
  Homebrew Channel's `startup.sh` at the next start; until then Telnet stays open, so step 8 follows at once.
- **The SSH key** is made on the laptop (Ed25519, Node's `crypto`, OpenSSH format, comment `hometv-lg`); only its
  public half goes to the TV. With `/home/root/.ssh/authorized_keys` present, `startup.sh` no longer sets its default
  root password (`alpine`). It goes in `lg-root-key` (`HOMETV_ROOT_KEY` names another), made once and kept; on
  Windows only this account may read it, as Windows' ssh requires. From Windows:
  `ssh -i %USERPROFILE%\HomeTV\lg-root-key root@<tv ip>`.
- **"Block system updates" is switched on** in step 7, as a second layer behind Allow Automatic Updates being off
  (decided). What it does, from `startup.sh`: while the flag
  `/var/luna/preferences/webosbrew_block_updates` exists, each start copies `/etc/hosts` to `/tmp`, mounts the copy
  over it in memory and points `snu.lge.com`, `su-dev.lge.com`, `su.lge.com` and `su-ssl.lge.com` at the TV itself
  (IPv4 and IPv6), so the TV can't reach those update servers: automatic updates and the menu's update check should
  both fail (read from the source, not tried); a USB update doesn't go through them. Nothing is written to the
  firmware; undo: switch it off, restart. It
  works alongside HomeTV's debloat, which mounts its own copy of the hosts file on top. Step 7 checks it took.
- **The restart check asks the person** whether HomeTV is on screen: the takeover mounts HomeTV over LG's Home and
  keeps LG Home's app id (`com.webos.app.home`), so LG's remote-control connection reports the same app either way.

Only the test TV can prove: that Dev Manager installs the `.ipk`; that the TV's Telnet shell has `base64`,
`sha256sum`, `node` and `luna-send`, and that root's `luna-send` may call LG's installer and Homebrew Channel's
service; that the shell's line editing takes the 800-character lines; that SlopBro roots this TV and its alert offers
"Reboot now"; that `install.sh` passes on the real paths; that Telnet closes and SSH opens after the restart; and that
HomeTV comes up as Home.

Sources: Homebrew Channel ([webosbrew/webos-homebrew-channel](https://github.com/webosbrew/webos-homebrew-channel),
MIT), tag v0.7.3 (`92fcf9f`, the version SlopBro installs; the parts used are unchanged on `main` at `6e928d0`,
2026-11-03): `services/service.ts` (`getConfiguration`, `setConfiguration`, the flag files),
`services/startup.sh` (Telnet, SSH, the default password, Block system updates), `frontend/views/SettingsPanel.js`
(the same switches in its Settings), `tools/install.sh`. SlopBro `wwwroot/autoroot.sh` at `21023d5` (install as root,
the "Rooting complete" alert). webosbrew/pages `content/pages/cheatsheet.md` (`dev/install` from local storage).
