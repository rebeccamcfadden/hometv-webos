> [!WARNING]
> **Work in progress, not tested on a real TV.** The root steps are research: nothing here should be run on a TV without
> the owner's agreement and the backup and way back in [root-plan.md](root-plan.md).

## The laptop tool's install steps

`hometv-lg install <tv address>` (or double-click `hometv-lg.exe` and choose 2) takes the test TV from "Developer Mode
on" to "HomeTV is Home (root edition)", in the order decided in [root-plan.md](root-plan.md). Code:
[tools/lib/install-steps.mjs](../tools/lib/install-steps.mjs); tests against pretend TVs:
[tests/install.test.mjs](../tests/install.test.mjs).

| # | Step (`--from` name) | What the tool does | Stops if | Changes on the TV |
|---|---|---|---|---|
| 1 | `backup` | Reads what LG's remote-control connection allows (model, software, apps, inputs, picture and sound settings) into `lg-backup-….json` | The TV can't be reached or paired | Nothing |
| 2 | `dev-install` | Shows the webOS Dev Manager steps for HomeTV's `.ipk`, then checks the TV lists `com.hometv.app` and that it opens. Skipped if Homebrew Channel is already there | HomeTV isn't listed, or doesn't open | HomeTV as a Developer Mode app (the person installs it) |
| 3 | `go-on` | Asks whether to root now. "No" stops here; the next run asks again | - | Nothing |
| 4 | `root-checks` | Software is 33.31.61 (only `major_ver` and `minor_ver` are read); the Developer Mode app isn't listed, and the person confirms a restart since; Python and SlopBro are in the HomeTV folder with SlopBro's pinned SHA-256; the person confirms the USB stick (LG's firmware in `LG_DTV`) and Allow Automatic Updates off; the TV reaches the laptop | Any of these | Nothing (the TV's browser opens for a moment) |
| 5 | `root` | Says what SlopBro does and that the full undo is a factory reset, then runs it only after the person types `root the TV`. Checks SlopBro's SHA-256 again first. Skipped if Homebrew Channel is already there | Anything else is typed (nothing runs); SlopBro ends with an error | Root and Homebrew Channel ([root-plan.md](root-plan.md), "What root changes") |
| 6 | `hbc-check` | After root's restart, `org.webosbrew.hbchannel` must be in the app list | It isn't (Q-R2): don't run SlopBro again, tell the team; level 3 if the TV misbehaves | Nothing |
| 7 | `root-install` | Over Homebrew Channel's Telnet (below): copies `root/` to `/media/developer/hometv`, puts HomeTV back if it's gone, runs `install.sh`, adds the laptop's SSH key, switches Telnet off and SSH on (from the next start) | Telnet closed; the shell isn't root; `base64`, `sha256sum`, `node` or `luna-send` missing; no start-up hooks folder; Homebrew Channel not running as root; a file arrives damaged; HomeTV can't be installed; `install.sh` refuses; Homebrew Channel doesn't take the switches | The root edition's files and two start-up hooks; HomeTV; one line in `/home/root/.ssh/authorized_keys`; two of Homebrew Channel's switches |
| 8 | `restart-check` | Asks for a restart, then checks Home is on screen, asks the person whether it's HomeTV, checks Telnet (23) is closed and SSH (22) answers | Any of these | Nothing |

How it behaves:

- **One step at a time.** Before each, it prints what the step does and how it's undone. The first failed check stops
  the run with what to do next; nothing after it runs.
- **Run again to carry on.** Finished steps are kept in `install-state.json` (HomeTV folder) and skipped.
  `--from <step>` runs again from a step on; `--list` shows each step's state. A "no" or a stop leaves the step to run
  again next time.
- **Questions only the person can answer** (a restart, the USB stick, LG's update switch, what's on screen) are
  `[y/N]`: anything but "y" stops.
- **What it keeps, in `%USERPROFILE%\HomeTV`:** `lg-backup-….json`, `lg-client-key` (the pairing, shared with
  `hometv-lg check`), `install-state.json`, `install-log.txt` (everything it printed), and `ssh\hometv-lg_ed25519`
  with its `.pub`. Nothing it prints or keeps holds the TV's address, serial number, device id, MAC or the Windows
  user name. SlopBro's own messages (step 5) do show the TV's address: they're on screen only.
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
  root password (`alpine`). From Windows: `ssh -i %USERPROFILE%\HomeTV\ssh\hometv-lg_ed25519 root@<tv ip>`.
- **"Block system updates" is left as it is** (Rebecca's call). What it does, from `startup.sh`: while the flag
  `/var/luna/preferences/webosbrew_block_updates` exists, each start copies `/etc/hosts` to `/tmp`, mounts the copy
  over it in memory and points `snu.lge.com`, `su-dev.lge.com`, `su.lge.com` and `su-ssl.lge.com` at the TV itself
  (IPv4 and IPv6), so the TV can't reach those update servers: automatic updates and the menu's update check should
  both fail (read from the source, not tried); a USB update doesn't go through them. Nothing is written to the
  firmware; undo: switch it off, restart. It
  works alongside HomeTV's debloat, which mounts its own copy of the hosts file on top. Step 7 prints its state.
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
