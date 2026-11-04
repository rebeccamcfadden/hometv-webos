# Backup and restore

> [!WARNING]
> Work in progress, tested against pretend TVs only. Nothing here has run on a real TV yet.

Before anything changes on the TV, the laptop keeps a copy of the TV's settings; afterwards, `hometv-lg restore`
puts them back. LG TVs have no settings export of their own, so this is what the tool can read, plus the photos in
[root-plan.md](root-plan.md#backup-step-3). Code: `tools/lib/backup.mjs`, `tools/lib/restore.mjs`,
`tools/restore.mjs`; tests: `tests/backup.test.mjs`.

## Taking a backup

```
hometv-lg check <tv address> --backup           # without root
hometv-lg check <tv address> --backup --root    # a rooted TV: also what root can read
```

The double-clicked tool takes the first kind by itself. The installer calls the same code
(`backup(tv, dir, { shell })`).

### What is saved, without root

Over LG's remote-control connection (the one LG's phone app uses; the TV shows "Allow" once). The laptop asks for the
fewest permissions: reading apps, inputs, settings and the software version, no writing (`tools/lib/ssap.mjs`).

| What | How | Permission (our reading) |
|---|---|---|
| Model, software version | `system/getSystemInfo`, `com.webos.service.update/getCurrentSWInformation` | none (answered before pairing), `READ_UPDATE_INFO` |
| The apps, in the order the TV lists them | `com.webos.applicationManager/listLaunchPoints` | `READ_INSTALLED_APPS` |
| The app on screen (picture and sound settings are kept per input) | `getForegroundAppInfo` | `READ_RUNNING_APPS` |
| The inputs | `tv/getExternalInputList` | `READ_INPUT_DEVICE_LIST` |
| Sound output | `audio/getSoundOutput` | `READ_SETTINGS` |
| 18 settings: picture mode and levels, sound mode and output, country, language, Audio Guidance, Quick Start+, Power On Screen, Always Ready, AI Picture | `settings/getSystemSettings`, one key at a time | `READ_SETTINGS` |

LG doesn't publish which permission each call needs; the names are from the pairing manifest (Home Assistant's
aiowebostv). The backup records, for every read, the permission and whether the TV answered, so the first real run
shows what the TV allowed. Serial number, device id, MAC and IP addresses and app icons are dropped even here.

### What is saved, with root

Through a root shell (Homebrew Channel's SSH, with a key; Windows' own `ssh.exe`, `tools/lib/root-shell.mjs`). Read
only: every command is checked against a short list before it runs (`id -u`, `luna-send` to the read methods below,
`tar` to the laptop), and anything else is refused.

| What | Where on the TV | Why |
|---|---|---|
| Whole settings categories (picture, sound, option, general, time, network, caption, lock, AI…, and any other the settings database holds) | LG's settings service, `luna://com.webos.settingsservice/getSystemSettings` with a category and no keys | What restore writes back |
| The settings database's records | Database kind `com.webos.settings.system:1`, read with `com.webos.service.db/find` (then `com.palm.db/find`) | Every input and picture mode's values, not only the current one; for reference |
| The app manager's launch points | Kinds `com.webos.applicationManager.launchpoints:2` and `:1` | LG Home's app row, for reference |
| A copy of Luna's preferences folder | `/var/luna/preferences` (a `.tar` next to the backup) | Small state files: Developer Mode's flag, Homebrew Channel's switches, the app at power-on ([root-plan.md](root-plan.md#what-root-changes)) |

Not copied: the database files themselves (`/var/db/main`: live, large, and holding every app's data and sign-ins),
LG's signed partitions, the channel list (only an aerial uses one; photograph it), app sign-ins.

The kind names are those of webOS Open Source Edition (settingsservice `conf/SettingsService.h.in`, sam
`src/bus/client/DB8.cpp`); LG's own build may name them differently, and a kind the TV doesn't know is simply
recorded as missing.

### Where it goes

`%USERPROFILE%\HomeTV\backups\lg-backup-<date and time>.json` (and `…-files.tar` with root), on the laptop only. It
is never part of the check's report (`lg-check-….json`, the file that is sent back), which stays as it was.

**A backup may hold identifiers** (the TV's name, network names, the parental PIN with root): the tool never prints
them, and says so each time. Keep the file; don't send or share it.

## Restoring

```
hometv-lg restore <backup file> <tv address>                  # without root: menu steps
hometv-lg restore <backup file> <tv address> --root --dry-run # with root: what would change, nothing written
hometv-lg restore <backup file> <tv address> --root           # with root: writes after you type "restore"
```

Every run starts with a **dry run**: the backup's values against the TV's now, setting by setting. Nothing is written
in a dry run.

**Without root** (a paired app can read settings but not write them): the tool reads the TV over the remote-control
connection and prints, for each setting that differs, where it is in the menus and what to set it to (webOS 23-25
paths, from [privacy.md](privacy.md); for anything else, the settings search). Nothing changes on the TV.

**With root:**

1. Pre-checks; any failure stops before anything is written: the shell is root (`id -u` is 0); the TV is the
   backup's model. A different software version, or another input on screen than at the backup, is shown as a
   note.
2. The dry run (above).
3. You type `restore` (anything else stops).
4. Only keys present in the backup, and only those that differ, through LG's settings service
   (`luna://com.webos.settingsservice/setSystemSettings`), **one category at a time**. Each category is read back
   afterwards. **The first error stops it**: a refused write, or a value that reads back different. The tool says
   which categories were written before it; everything after is untouched.

The tool only ever runs reads and `setSystemSettings`; anything else is refused before it reaches the TV. It never
factory-resets.

### What restore leaves to you

- **Categories it doesn't write:** network (a wrong value could take the TV off Wi-Fi and the laptop with it), lock
  (the parental PIN), channels and LG's service menus. They're listed "by hand", without their values.
- **Agreements and consents** (User Agreements, terms, privacy choices): never set behind LG's own screens; by hand,
  from the photos and [privacy.md](privacy.md).
- **Picture and sound per input:** LG keeps them per input and picture mode. The settings service reads and writes
  those of the input on screen, so restore with the TV on the same input as at the backup (the tool notes when it
  isn't). Other inputs' values are in the backup's database records, for reference; they are not written.
- **LG Home's app order, app sign-ins, Wi-Fi password, LG account:** by hand (the backup has the app list, in the
  TV's order).

## HomeTV's own state (proposed, not built)

HomeTV keeps its own choices in its page's `localStorage`, which LG deletes when the app is removed or updated and
which a factory reset clears:

| Key | What |
|---|---|
| `hometv-home-row` | The Home row's apps and their order |
| `hometv-utility-moves` | Apps moved in or out of the TV utilities folder |
| `hometv-household-v1` | My list, Seen, Favorites, recent searches |

Not to export: `hometv-ssap-key` (the page's own pairing key, a secret, and worthless on a reset TV) and
`hometv-checks-v1` (test results).

The proposal: a page-side **Export** in HomeTV's settings that writes those three keys, with a version, to a file
through HomeTV's service (`service/service.js`; a service's files aren't visible to other apps), and an **Import** that
reads one back, checks the version and each key's shape, and replaces only those keys. The laptop then fetches the
file with the backup (with root: one more read-only `cat` of that file; without root: Developer Mode's
`ares-pull`, or the phone page shows it as a QR/download). Restore pushes it back the same way, then Import. Nothing
of this is built yet.

## Only a real TV can prove

- Which settings keys and categories LG's webOS 25 really has, and which the remote-control connection may read.
- That `getSystemSettings` without keys returns a whole category, and that root's `luna-send` may call
  `setSystemSettings` and read the database kinds (and their names on LG's build).
- That a value written back sticks after a restart, and lands on the input on screen.
- Homebrew Channel's SSH as root with a key, from Windows' `ssh.exe`.
- How big `/var/luna/preferences` is, and that `tar` exists there (busybox).
